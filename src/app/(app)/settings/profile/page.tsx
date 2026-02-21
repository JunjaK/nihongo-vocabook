'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { createClient } from '@/lib/supabase/client';
import { fetchProfile, saveProfile } from '@/lib/profile/fetch';

type StudyPurpose = 'certification' | 'study' | 'other';
const JLPT_LEVELS = [5, 4, 3, 2, 1] as const;

export default function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nickname, setNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [jlptLevel, setJlptLevel] = useState<number>(3);
  const [studyPurpose, setStudyPurpose] = useState<StudyPurpose>('study');
  const [otherPurpose, setOtherPurpose] = useState('');

  // Password change
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((profile) => {
        setNickname(profile.nickname ?? '');
        setAvatarUrl(profile.avatarUrl);
        if (profile.jlptLevel) setJlptLevel(profile.jlptLevel);
        if (profile.studyPurpose) {
          if (profile.studyPurpose === 'certification' || profile.studyPurpose === 'study') {
            setStudyPurpose(profile.studyPurpose);
          } else {
            setStudyPurpose('other');
            setOtherPurpose(profile.studyPurpose);
          }
        }
      })
      .catch(() => {
        // Ignore — new user might not have settings
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${user.id}/avatar.${ext}`;
    const supabase = createClient();

    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (error) {
      toast.error(error.message);
      return;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    setAvatarUrl(url);
    await saveProfile({ avatarUrl: url });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const purpose = studyPurpose === 'other' ? otherPurpose.trim() : studyPurpose;
      await saveProfile({
        nickname: nickname.trim(),
        jlptLevel,
        studyPurpose: purpose || null,
      });
      toast.success(t.profile.saved);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) return;
    if (newPassword !== confirmPassword) return;

    setChangingPassword(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(t.profile.passwordChanged);
        setNewPassword('');
        setConfirmPassword('');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const passwordValid = newPassword.length >= 8 && /[a-zA-Z]/.test(newPassword) && /\d/.test(newPassword);
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const purposeOptions: { value: StudyPurpose; label: string }[] = [
    { value: 'certification', label: t.profile.purposeCertification },
    { value: 'study', label: t.profile.purposeStudy },
    { value: 'other', label: t.profile.purposeOther },
  ];

  if (loading) {
    return (
      <>
        <Header title={t.profile.title} showBack />
        <div className="p-4 text-center text-sm text-muted-foreground">
          {t.common.loading}
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={t.profile.title} showBack />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* Avatar */}
          <section className="flex items-center gap-4">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-full bg-muted">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-2xl text-muted-foreground">
                  {nickname?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="profile-change-avatar"
              >
                {t.profile.changeAvatar}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
          </section>

          <Separator />

          {/* Nickname */}
          <section className="space-y-2">
            <Label>{t.profile.nickname}</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t.profile.nicknamePlaceholder}
              data-testid="profile-nickname-input"
            />
          </section>

          <Separator />

          {/* JLPT Level */}
          <section className="space-y-2">
            <Label>{t.profile.jlptLevel}</Label>
            <div className="flex gap-2">
              {JLPT_LEVELS.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={jlptLevel === level ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setJlptLevel(level)}
                  data-testid={`profile-jlpt-n${level}`}
                >
                  N{level}
                </Button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Study Purpose */}
          <section className="space-y-2">
            <Label>{t.profile.studyPurpose}</Label>
            <div className="flex gap-2">
              {purposeOptions.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  variant={studyPurpose === opt.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStudyPurpose(opt.value)}
                  data-testid={`profile-purpose-${opt.value}`}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            {studyPurpose === 'other' && (
              <Input
                value={otherPurpose}
                onChange={(e) => setOtherPurpose(e.target.value)}
                placeholder={t.profile.purposeOtherPlaceholder}
                data-testid="profile-purpose-other-input"
              />
            )}
          </section>

          <Separator />

          {/* Change Password */}
          <section className="space-y-3">
            <Label className="text-sm font-semibold">{t.profile.changePassword}</Label>
            <div className="space-y-2">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t.profile.newPassword}
                data-testid="profile-new-password"
              />
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t.profile.confirmNewPassword}
                data-testid="profile-confirm-password"
              />
              {passwordMismatch && (
                <p className="text-sm text-destructive">{t.auth.passwordMismatch}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangePassword}
                disabled={changingPassword || !passwordValid || passwordMismatch}
                data-testid="profile-change-password-button"
              >
                {t.profile.changePassword}
              </Button>
            </div>
          </section>
        </div>

        {/* Bottom save button */}
        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving}
            data-testid="profile-save-button"
          >
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </div>
    </>
  );
}
