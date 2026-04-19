/**
 * Supabase Edge Function: send-study-reminder
 *
 * Invoked every 15 minutes by pg_cron. For each user whose notification
 * time (KST) matches the current 15-min window AND hasn't been notified
 * today AND hasn't hit their daily goal, sends a web push.
 *
 * Required env:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 *   - VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const KST_OFFSET_MIN = 9 * 60; // UTC+9
const WINDOW_MIN = 15; // pg_cron fires every 15 min

interface SettingsRow {
  user_id: string;
  daily_goal: number;
  notification_hour: number;
  notification_minute: number;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DailyStatsRow {
  user_id: string;
  date: string;
  review_count: number;
  mastered_in_session_count: number;
  notification_sent_at: string | null;
}

function getKstNow(): { hour: number; minute: number; date: string } {
  const utcNow = new Date();
  const kstMs = utcNow.getTime() + KST_OFFSET_MIN * 60 * 1000;
  const kst = new Date(kstMs);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return {
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
    date: `${year}-${month}-${day}`,
  };
}

/** Returns true when (hh:mm) falls within [nowHH:nowMM - window, nowHH:nowMM]. */
function isInCurrentWindow(
  settingHour: number,
  settingMinute: number,
  nowHour: number,
  nowMinute: number,
): boolean {
  const settingTotal = settingHour * 60 + settingMinute;
  const nowTotal = nowHour * 60 + nowMinute;
  const diff = nowTotal - settingTotal;
  return diff >= 0 && diff < WINDOW_MIN;
}

async function computeStreak(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  todayDate: string,
): Promise<number> {
  const { data } = await supabase
    .from('daily_stats')
    .select('date, review_count')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(100);
  if (!data || data.length === 0) return 0;

  const activeDates = new Set(
    data
      .filter((d) => (d.review_count ?? 0) > 0)
      .map((d) => d.date as string),
  );

  let streak = 0;
  const cursor = new Date(todayDate + 'T00:00:00Z');
  if (!activeDates.has(todayDate)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (true) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    if (activeDates.has(key)) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function buildMessage(remaining: number, streak: number): { title: string; body: string } {
  const title = 'Nihongo VocaBook';
  if (streak >= 2) {
    return {
      title,
      body: `🔥 ${streak}일 연속 학습 중! 오늘은 ${remaining}개 남았어요.`,
    };
  }
  return {
    title,
    body: `오늘의 학습이 ${remaining}개 남았어요.`,
  };
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID_NOT_CONFIGURED' }), { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const now = getKstNow();

  const { data: settingsAll, error: settingsErr } = await supabase
    .from('quiz_settings')
    .select('user_id, daily_goal, notification_hour, notification_minute')
    .eq('notification_enabled', true);

  if (settingsErr) {
    console.error('[reminder] settings query failed', settingsErr.message);
    return new Response(JSON.stringify({ error: 'SETTINGS_QUERY_FAILED' }), { status: 500 });
  }

  const matched = ((settingsAll ?? []) as SettingsRow[]).filter((s) =>
    isInCurrentWindow(s.notification_hour, s.notification_minute, now.hour, now.minute),
  );

  if (matched.length === 0) {
    return new Response(JSON.stringify({ window: now, matched: 0 }));
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const s of matched) {
    try {
      // Already-notified-today check
      const { data: statsRow } = await supabase
        .from('daily_stats')
        .select('user_id, date, review_count, mastered_in_session_count, notification_sent_at')
        .eq('user_id', s.user_id)
        .eq('date', now.date)
        .maybeSingle();

      const stats = statsRow as DailyStatsRow | null;
      if (stats?.notification_sent_at) {
        skipped += 1;
        continue;
      }

      const done = (stats?.review_count ?? 0) + (stats?.mastered_in_session_count ?? 0);
      if (done >= s.daily_goal) {
        skipped += 1;
        continue;
      }

      const remaining = s.daily_goal - done;
      const streak = await computeStreak(supabase, s.user_id, now.date);

      // Fetch subscriptions
      const { data: subsData } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', s.user_id);

      const subs = (subsData ?? []) as SubscriptionRow[];
      if (subs.length === 0) {
        skipped += 1;
        continue;
      }

      const msg = buildMessage(remaining, streak);
      const payload = JSON.stringify({ title: msg.title, body: msg.body });

      await Promise.allSettled(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
            );
            sent += 1;
          } catch (err) {
            errors += 1;
            const statusCode = (err as { statusCode?: number }).statusCode;
            // 404/410 = subscription gone; delete it
            if (statusCode === 404 || statusCode === 410) {
              await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', sub.endpoint);
            } else {
              console.warn('[reminder] push failed', statusCode, err);
            }
          }
        }),
      );

      // Mark notified for today (upsert)
      await supabase
        .from('daily_stats')
        .upsert(
          {
            user_id: s.user_id,
            date: now.date,
            notification_sent_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,date' },
        );
    } catch (err) {
      errors += 1;
      console.error('[reminder] per-user failure', err);
    }
  }

  return new Response(
    JSON.stringify({ window: now, matched: matched.length, sent, skipped, errors }),
  );
});
