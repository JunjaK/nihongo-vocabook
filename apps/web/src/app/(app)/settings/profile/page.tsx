'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { createClient } from '@/lib/supabase/client';
import { fetchProfile, saveProfile } from '@/lib/profile/fetch';
import { bottomBar, bottomSep, settingsScroll, settingsSection, settingsHeading } from '@/lib/styles';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox';

type StudyPurpose = 'certification' | 'study' | 'other';

interface JlptOption {
  level: number;
  label: string;
}

const JLPT_OPTIONS: JlptOption[] = [
  { level: 5, label: 'N5' },
  { level: 4, label: 'N4' },
  { level: 3, label: 'N3' },
  { level: 2, label: 'N2' },
  { level: 1, label: 'N1' },
];

export default function ProfilePage() {
  const router = useRouter();
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
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteAccount = async () => {
    setShowDeleteConfirm(false);
    setDeletingAccount(true);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) throw new Error();

      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success(t.profile.accountDeleted);
      router.push('/');
    } catch {
      toast.error('Failed to delete account');
    } finally {
      setDeletingAccount(false);
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
        <div className="flex flex-1 flex-col items-center justify-center text-sm text-muted-foreground">
          {t.common.loading}
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button className="w-full" disabled>{t.common.save}</Button>
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

          {/* Profile fields — grouped without separators */}
          <section className="space-y-5">
            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label>{t.profile.email}</Label>
              <div className="text-sm text-muted-foreground">
                {user?.email}
              </div>
            </div>

            {/* Nickname */}
            <div className="space-y-1.5">
              <Label>{t.profile.nickname}</Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t.profile.nicknamePlaceholder}
                data-testid="profile-nickname-input"
              />
            </div>

            {/* JLPT Level */}
            <div className="space-y-1.5">
              <Label>{t.profile.jlptLevel}</Label>
              <Combobox
                value={JLPT_OPTIONS.find((o) => o.level === jlptLevel) ?? null}
                onValueChange={(val: JlptOption | null) => {
                  if (val) setJlptLevel(val.level);
                }}
                itemToStringLabel={(item: JlptOption) => item.label}
              >
                <ComboboxInput
                  placeholder={t.profile.jlptLevel}
                  data-testid="profile-jlpt-select"
                />
                <ComboboxContent>
                  <ComboboxList>
                    {JLPT_OPTIONS.map((opt) => (
                      <ComboboxItem key={opt.level} value={opt}>
                        {opt.label}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            {/* Study Purpose */}
            <div className="space-y-1.5">
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
            </div>
          </section>

          <Separator />

          {/* Change Password */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-sm font-medium">{t.profile.changePassword}</span>
              <div className="flex-1" />
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
            </div>
          </section>

          <Separator />

          {/* Delete Account */}
          <section className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <Label className="text-sm font-semibold text-destructive">
              {t.profile.deleteAccount}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t.profile.deleteAccountWarning}
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deletingAccount}
              data-testid="profile-delete-account-button"
            >
              {t.profile.deleteAccount}
            </Button>
          </section>
        </div>

        {/* Bottom save button */}
        <div className={bottomBar}>
          <div className={bottomSep} />
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

      <ConfirmDialog
        open={showDeleteConfirm}
        icon={<span className="text-2xl">⚠️</span>}
        title={t.profile.deleteAccount}
        description={t.profile.deleteAccountConfirm}
        confirmLabel={t.profile.deleteAccount}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
