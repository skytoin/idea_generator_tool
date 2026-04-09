'use client';

import { ProfileForm } from '@/components/frame/profile-form';

/**
 * Frame intake page — thin wrapper that renders the ProfileForm
 * container. All state and logic live in ProfileForm.
 */
export default function FramePage() {
  return (
    <main className="min-h-screen p-8">
      <ProfileForm />
    </main>
  );
}
