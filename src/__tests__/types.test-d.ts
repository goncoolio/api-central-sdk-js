// =============================================================================
// Tests de typage, vérifiés par `npm run typecheck` (tsc) et non par vitest.
//
// Chaque bloc confronte un type public du SDK au contrat réel de l'API Rust.
// Une directive `@ts-expect-error` devenue inutile fait échouer tsc : un type
// qui dérive du contrat casse donc la vérification.
// =============================================================================

import type { ApiCentral, PresenceStatusItem, ReactionCount, RealtimeModule } from '../index';

type Resolved<T> = T extends Promise<infer R> ? R : never;
type Calls = ApiCentral['calls'];
type Live = ApiCentral['live'];

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

// -----------------------------------------------------------------------------
// Appels : GET /calls/{id}/ice-servers renvoie { ice_servers, call_id, ttl }
// -----------------------------------------------------------------------------

declare const iceServers: Resolved<ReturnType<Calls['getIceServers']>>;
expectType<string>(iceServers.callId);
expectType<number>(iceServers.ttl);

// -----------------------------------------------------------------------------
// Live : GET /live/streams/{id}/stats renvoie StreamStats (src/types/live.rs)
// -----------------------------------------------------------------------------

declare const stats: Resolved<ReturnType<Live['getStats']>>;
expectType<string>(stats.streamId);
expectType<number>(stats.viewerCount);
expectType<number>(stats.peakViewerCount);
expectType<number>(stats.totalComments);
expectType<number>(stats.totalReactions);
expectType<ReactionCount[]>(stats.reactionsByEmoji);
// null tant que le live n'a pas démarré : Option<i64> est sérialisé en null
expectType<number | null>(stats.durationSeconds);
// @ts-expect-error l'API ne calcule ni vues totales ni temps de visionnage
expectType<number>(stats.totalViews);

// -----------------------------------------------------------------------------
// Live : GET /live/streams ne lit que status (StreamStatusQuery) et la
// pagination (src/api/live.rs)
// -----------------------------------------------------------------------------

declare const live: Live;
void live.listStreams({ status: 'live', page: 1, limit: 20 });
// @ts-expect-error l'API ignore hostId : ce filtre n'existe pas
void live.listStreams({ hostId: 'user-uuid' });

// -----------------------------------------------------------------------------
// Temps réel : presence_status transporte { statuses } (src/ws/events.rs)
// -----------------------------------------------------------------------------

declare const realtime: RealtimeModule;
realtime.onPresenceStatus((event) => {
  expectType<PresenceStatusItem[]>(event.statuses);
  expectType<string>(event.statuses[0]!.userId);
});
// @ts-expect-error l'événement est { statuses }, pas un tableau
realtime.onPresenceStatus((event) => event.map((item) => item.userId));
