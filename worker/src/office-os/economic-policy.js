/** Server-only pilot scope. No default office, no phone-suffix inference. */
export function economicModeFor(env = {}, officeId = '') {
  return env.DEPLOYMENT_ENV === 'staging' && env.FIREBASE_PROJECT_ID === 'iaqar-ai-staging'
    && env.ECONOMIC_TEST_MODE === 'enabled' && Boolean(officeId)
    && env.ECONOMIC_TEST_OFFICE_ID === officeId;
}

/** Remove paid providers/outbound capabilities before binding the existing service adapters. */
export function economicEnvironment(env, officeId) {
  if (!economicModeFor(env, officeId)) return env;
  return { ...env, ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '',
    SERPER_API_KEY: '', BRAVE_API_KEY: '', AI: undefined, META_WHATSAPP_ACCESS_TOKEN: '',
    WHATSAPP_AGENT_SEND: '', TELEGRAM_OUTBOUND: '', TELEGRAM_BOT_TOKEN: '', KAPSO_API_KEY: '' };
}

export function economicContext(ctx, officeId = ctx.officeId) {
  if (!economicModeFor(ctx.env, officeId)) return ctx;
  const blocked = async () => { throw ctx.deps.appError('economic_outbound_disabled', 403, 'الإرسال والخدمات الخارجية متوقفة أثناء التجربة'); };
  return { ...ctx, officeId, env: economicEnvironment(ctx.env, officeId), deps: { ...ctx.deps,
    callGemini: undefined, telegram: blocked, sendOfficePush: undefined,
    // Test records must not create operational matches/review tasks in the office inbox.
    // The lab calls searchThroughCentral explicitly so it can show real candidates without
    // persisting a live workflow until the manager chooses to start a test journey.
    ...(ctx.deps.runMatching ? { runMatching: async () => ({ matches: 0, matchingPending: false, economicTestDeferred: true }) } : {})
  } };
}
