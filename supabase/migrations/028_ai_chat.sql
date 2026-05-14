-- AI Assistant chat — sessions, messages, tool executions.
-- See _docs/ai-assistant-and-footer-redesign.md for design rationale.
--
-- Schema supports multi-session (forward-compatible); Phase 1 UI exposes
-- a single rolling session per user.

-- ---------------------------------------------------------------------------
-- ai_sessions — conversation containers (scope + meta + activity tracking)
-- ---------------------------------------------------------------------------

create table if not exists ai_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Scope binds a session to a domain entity. Phase 1 persists only 'general';
  -- volatile context scopes (word/wordbook/quiz) live in client memory.
  scope           text not null default 'general'
                  check (scope in ('general')),
  scope_entity_id text,

  -- Meta
  title           text,
  context_snapshot jsonb,

  -- Activity counters (denormalized for fast list view in Phase 2 UI).
  last_message_at timestamptz,
  message_count   integer not null default 0,
  total_input_tokens  integer not null default 0,
  total_output_tokens integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ai_sessions_user_active_idx
  on ai_sessions(user_id, last_message_at desc nulls last);

alter table ai_sessions enable row level security;

create policy "users access own ai_sessions" on ai_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ai_messages — unified message table (role column, content as JSONB array)
-- ---------------------------------------------------------------------------

create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references ai_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  role            text not null
                  check (role in ('user', 'assistant', 'tool', 'system')),

  -- Content blocks array: [{ type: 'text' | 'image' | 'tool_result', ... }]
  content         jsonb not null,

  -- Assistant-only: array of PendingToolCall objects parsed from <tool_call>
  -- tags. Null for non-assistant roles.
  tool_calls      jsonb,

  -- Lifecycle of this message.
  status          text not null default 'complete'
                  check (status in ('streaming','complete','truncated','cancelled','failed')),
  finish_reason   text,

  -- Assistant-only telemetry. Null for non-assistant.
  input_tokens    integer,
  output_tokens   integer,
  model_variant   text,

  -- Failure info (status = 'failed').
  error_code      text,
  error_message   text,

  -- Reference to IndexedDB chat_attachments rows. Binary blobs are local-only;
  -- this column lets us render [image] placeholders on cross-device hydrate.
  attachment_ids  jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists ai_messages_session_created_idx
  on ai_messages(session_id, created_at);
create index if not exists ai_messages_user_idx
  on ai_messages(user_id);

alter table ai_messages enable row level security;

create policy "users access own ai_messages" on ai_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep ai_sessions activity counters in sync.
create or replace function ai_messages_update_session_activity()
returns trigger as $$
begin
  update ai_sessions
  set
    last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), new.created_at),
    message_count   = message_count + 1,
    total_input_tokens = total_input_tokens + coalesce(new.input_tokens, 0),
    total_output_tokens = total_output_tokens + coalesce(new.output_tokens, 0),
    updated_at      = now()
  where id = new.session_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists ai_messages_after_insert on ai_messages;
create trigger ai_messages_after_insert
  after insert on ai_messages
  for each row
  execute function ai_messages_update_session_activity();

-- ---------------------------------------------------------------------------
-- ai_tool_executions — analytics + status history for individual tool calls
-- ---------------------------------------------------------------------------

create table if not exists ai_tool_executions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references ai_messages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  tool_name       text not null,
  tool_call_id    text not null,
  args            jsonb not null,

  status          text not null
                  check (status in (
                    'awaiting_confirm',
                    'running',
                    'done',
                    'cancelled',
                    'failed',
                    'skipped_by_user'
                  )),
  result          jsonb,
  error_message   text,

  duration_ms     integer,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists ai_tool_executions_user_tool_idx
  on ai_tool_executions(user_id, tool_name, created_at desc);

alter table ai_tool_executions enable row level security;

create policy "users access own ai_tool_executions" on ai_tool_executions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
