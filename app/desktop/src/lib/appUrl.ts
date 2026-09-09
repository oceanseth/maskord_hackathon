/**
 * Base URL of the running web app.
 *
 * Anything user-facing that links back into Maskord — OAuth redirects, invite
 * links — has to point at the host the user is actually on. Hardcoding
 * www.maskord.com sends people from any other deployment to production, which
 * is how Twitch sign-in was landing on the wrong site.
 *
 * On www.maskord.com this resolves to exactly the value it always was.
 */
export function appBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://www.maskord.com/app';
  return `${window.location.origin}/app`;
}

export function inviteUrl(code: string, voiceChannelId?: string): string {
  const url = `${appBaseUrl()}?invite=${encodeURIComponent(code)}`;
  return voiceChannelId ? `${url}&vc=${encodeURIComponent(voiceChannelId)}` : url;
}
