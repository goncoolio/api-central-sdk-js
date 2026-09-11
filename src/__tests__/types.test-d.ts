// =============================================================================
// Tests de typage, vérifiés par `npm run typecheck` (tsc) et non par vitest.
//
// Chaque bloc confronte un type public du SDK au contrat réel de l'API Rust.
// Une directive `@ts-expect-error` devenue inutile fait échouer tsc : un type
// qui dérive du contrat casse donc la vérification.
// =============================================================================

import type { ApiCentral } from '../index';

type Resolved<T> = T extends Promise<infer R> ? R : never;
type Calls = ApiCentral['calls'];

function expectType<T>(_value: T): void {}

// -----------------------------------------------------------------------------
// Appels : réponses des bascules média (src/api/calls.rs, set_mute / set_video)
// -----------------------------------------------------------------------------

declare const muteResult: Resolved<ReturnType<Calls['setMuted']>>;
expectType<boolean>(muteResult.muted);
// @ts-expect-error l'API renvoie { muted }, pas { success }
expectType<boolean>(muteResult.success);

declare const videoResult: Resolved<ReturnType<Calls['setVideoEnabled']>>;
expectType<boolean>(videoResult.videoEnabled);
// @ts-expect-error l'API renvoie { video_enabled }, pas { success }
expectType<boolean>(videoResult.success);

declare const screenResult: Resolved<ReturnType<Calls['setScreenSharing']>>;
expectType<boolean>(screenResult.screenSharing);
