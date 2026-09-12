# SDK JavaScript/TypeScript d'API Central

SDK officiel JavaScript/TypeScript d'API Central S2S : messagerie,
notifications, support, live streaming, appels audio et vidéo (P2P, et groupe
via LiveKit) et gestion des clés de chiffrement de bout en bout.

## Environnements

| Partie du SDK | Node.js ≥ 22 | Navigateur |
|---|---|---|
| Modules REST (`auth`, `users`, `messaging`, `notifications`, `support`, `live`, `calls`, `encryption`) | oui | oui |
| Temps réel (`connectRealtime`, `realtime`, `streamManager`) | oui | oui |
| Appels (`callManager`, `groupCallManager`, `autoCallManager`) | non | oui |

- **Node.js 22 ou plus récent est requis.** Le temps réel s'appuie sur le
  `WebSocket` global, absent de Node.js 18 et 20 (tous deux en fin de vie).
  Sans lui, `connectRealtime` lève une erreur explicite.
- **Les gestionnaires d'appels sont réservés au navigateur** : ils utilisent
  WebRTC (`RTCPeerConnection`), le micro et la caméra
  (`navigator.mediaDevices`), et `livekit-client` pour les appels de groupe.
- `streamManager` ne fait que du WebSocket (commentaires, réactions,
  spectateurs) : il fonctionne aussi sous Node.js. La lecture de la vidéo
  (HLS) se fait dans le navigateur, avec le lecteur de l'application.

## Installation

```bash
npm install @api-central/sdk

# Appels de groupe uniquement (navigateur)
npm install livekit-client@^2.22
```

`livekit-client` est une dépendance facultative : le SDK ne le charge, à la
demande, qu'au premier appel de groupe. Voir [Appels de groupe](#appels-de-groupe-livekit).

## Démarrage rapide

```typescript
import { ApiCentral } from '@api-central/sdk';

// Côté serveur, avec les identifiants de l'application
const sdk = new ApiCentral({
  baseUrl: 'https://api.example.com/s2s/v1',
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
  applicationId: 'your-app-uuid',
});

// Obtient et conserve le jeton JWT, renouvelé automatiquement
await sdk.authenticate();

const user = await sdk.users.create({
  externalUserId: 'user-123',
  displayName: 'John Doe',
  email: 'john@example.com',
});
```

Ne placez jamais `apiKey` ni `apiSecret` dans un navigateur : obtenez le jeton
utilisateur côté serveur (`sdk.auth.getUserToken`) et transmettez-le au client.

## Configuration

```typescript
interface ApiCentralConfig {
  baseUrl: string;          // URL de l'API, préfixe compris (…/s2s/v1)
  apiKey?: string;          // clé de l'application (serveur uniquement)
  apiSecret?: string;       // secret de l'application (serveur uniquement)
  token?: string;           // jeton JWT déjà obtenu (application ou utilisateur)
  applicationId?: string;   // en-tête X-Application-Id
  timeout?: number;         // délai des requêtes, en ms (30000 par défaut)
  wsUrl?: string;           // temps réel, ex. 'wss://api.example.com/events'
  callManagerConfig?: CallManagerConfig; // contraintes média, userId
}
```

Un jeton utilisateur (constructeur, `setToken`, `connectRealtime`) renseigne
aussi l'identifiant local des gestionnaires d'appels : ils en ont besoin pour
signaler à l'API les bascules micro, caméra et partage d'écran.

## Modules

### Auth

```typescript
// Jeton d'application (serveur uniquement)
const { accessToken, expiresIn } = await sdk.auth.getToken({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
});

// Jeton utilisateur, pour le temps réel et les appels
const { socketToken, expiresIn, user } = await sdk.auth.getUserToken({
  userId: 'user-uuid',
});
```

### Users

Utilisateurs, appareils et présence.

```typescript
const user = await sdk.users.create({
  externalUserId: 'ext-123',
  displayName: 'John Doe',
  email: 'john@example.com',
});

const byId = await sdk.users.get('user-uuid');
const byExternalId = await sdk.users.getByExternalId('ext-123');
const { data, pagination } = await sdk.users.list({ page: 1, limit: 20 });

// Appareil pour les notifications push
const device = await sdk.users.registerDevice('user-uuid', {
  deviceToken: 'fcm-token-xxx',
  platform: 'android',
  deviceInfo: { model: 'Pixel 7' },
});

// Présence : 'online' tant que l'utilisateur a une connexion temps réel ouverte
const presence = await sdk.users.getPresence('user-uuid'); // 'online' | 'offline'
```

`updatePresence` met à jour la date de dernière activité et renvoie le statut
envoyé, sans le conserver : la présence est dérivée des connexions WebSocket.

### Messaging

Conversations, messages, réactions et indicateurs de saisie.

```typescript
const dm = await sdk.messaging.createConversation({
  conversationType: 'direct',
  participantIds: ['user-1', 'user-2'],
});

const group = await sdk.messaging.createConversation({
  conversationType: 'group',
  participantIds: ['user-1', 'user-2', 'user-3'],
  name: 'Équipe projet',
});

const message = await sdk.messaging.sendMessage('conv-uuid', {
  senderId: 'user-uuid',
  content: 'Bonjour !',
});

// Message audio
const audioMessage = await sdk.messaging.sendMessage('conv-uuid', {
  senderId: 'user-uuid',
  content: 'Message vocal',
  contentType: 'audio',
  attachments: [{
    url: 'https://storage.example.com/audio.mp3',
    mimeType: 'audio/mpeg',
    name: 'message-vocal.mp3',
    size: 125000,
  }],
});

// Pagination par curseur
const { data, nextCursor, hasMore } = await sdk.messaging.listMessages('conv-uuid', { limit: 50 });

await sdk.messaging.addReaction('message-uuid', { userId: 'user-uuid', emoji: '👍' });
await sdk.messaging.sendTyping('conv-uuid', { userId: 'user-uuid' });
await sdk.messaging.markAsRead('conv-uuid', {
  userId: 'user-uuid',
  messageId: 'last-read-message-uuid',
});
```

### Notifications

Notifications push et in-app. `notificationType`, `title` et `body` sont
obligatoires (1-100, 1-255 et 1-1000 caractères). Tout type est accepté, y
compris des types à espace de noms comme `'news:meteo'`.

```typescript
const notification = await sdk.notifications.send({
  userId: 'user-uuid',
  notificationType: 'message',
  title: 'Nouveau message',
  body: 'John vous a écrit',
  data: { conversationId: 'conv-uuid' },
});

const { sentCount } = await sdk.notifications.sendBulk({
  userIds: ['user-1', 'user-2', 'user-3'],
  notificationType: 'system',
  title: 'Annonce',
  body: 'Mise à jour importante',
});

// À tous les utilisateurs de l'application
const { totalUsers } = await sdk.notifications.broadcast({
  notificationType: 'news:meteo',
  title: 'Alerte météo',
  body: 'Pluies intenses prévues',
  channels: ['push', 'in_app'],
});

// Depuis un modèle défini côté serveur
await sdk.notifications.sendTemplate({
  userId: 'user-uuid',
  templateSlug: 'new_message',
  variables: { sender: 'John', preview: 'Salut' },
});

const unread = await sdk.notifications.list('user-uuid', { unreadOnly: true });
const { count } = await sdk.notifications.getUnreadCount('user-uuid');
await sdk.notifications.markAsRead({ notificationIds: ['notif-1', 'notif-2'] });
await sdk.notifications.markAllAsRead('user-uuid');
```

Les modèles se gèrent côté serveur : le SDK envoie depuis un modèle existant,
sans pouvoir en créer, modifier ni supprimer.

### Support

Tickets et base de connaissances.

```typescript
const ticket = await sdk.support.createTicket({
  userId: 'user-uuid',
  subject: 'Impossible d’accéder à mon compte',
  description: 'Mot de passe oublié, la réinitialisation échoue',
  categoryId: 'category-uuid',
  priority: 'high',
});

const { data } = await sdk.support.listTickets({ status: 'open', page: 1 });

await sdk.support.changeStatus('ticket-uuid', {
  status: 'closed',
  note: 'Résolu par réinitialisation du mot de passe',
});

const article = await sdk.support.createArticle({
  title: 'Réinitialiser son mot de passe',
  slug: 'reinitialiser-mot-de-passe',
  content: '# Réinitialisation\n\n1. Cliquez sur « Mot de passe oublié »…',
  tags: ['compte', 'sécurité'],
});

const results = await sdk.support.listArticles({ search: 'mot de passe', publishedOnly: true });
```

### Live streaming

Diffusions en direct : l'hôte publie en RTMP, les spectateurs regardent en HLS.

```typescript
// Créer puis démarrer (jeton d'application, ou jeton de l'hôte)
const stream = await sdk.live.createStream({
  hostId: 'host-user-uuid',
  title: 'Mon premier live',
  description: 'Rejoignez-moi !',
});
const started = await sdk.live.startStream(stream.id);

// Lives en cours (tableau ; filtres : status, page, limit)
const live = await sdk.live.listStreams({ status: 'live', page: 1, limit: 20 });

// Spectateurs, commentaires, réactions
await sdk.live.joinStream(stream.id, { userId: 'viewer-uuid' });
await sdk.live.postComment(stream.id, { userId: 'viewer-uuid', content: 'Super live !' });
const reaction = await sdk.live.sendReaction(stream.id, { userId: 'viewer-uuid', emoji: '❤️' });
if (!reaction.accepted) {
  // Limite de débit par utilisateur : réessayer après retryAfterMs
}

// Statistiques
const stats = await sdk.live.getStats(stream.id);
// { streamId, viewerCount, peakViewerCount, totalComments, totalReactions,
//   reactionsByEmoji: [{ emoji, count }], durationSeconds (null avant le démarrage) }

await sdk.live.endStream(stream.id);
```

#### Diffuser (hôte)

- `rtmpUrl` et `streamKey` ne sont renvoyés qu'à l'hôte et aux appels serveur
  (jeton d'application) ; les spectateurs ne les reçoivent pas.
- **Publiez avec l'URL `rtmpUrl` exacte renvoyée par l'API**, sans jamais la
  reconstruire à partir de `streamKey`. Son format peut évoluer : une
  évolution prévue de l'API y placera l'identifiant du live et la clé en
  paramètre (`…/live/{streamId}?key={streamKey}`). Traitez `rtmpUrl` et
  `playbackUrl` comme des chaînes opaques.
- Un logiciel qui demande un serveur et une clé séparés, comme OBS : serveur =
  `rtmpUrl` jusqu'au dernier `/` (exclu), clé = tout ce qui suit, paramètres
  compris.

#### Regarder (spectateurs)

`playbackUrl` est une URL HLS (`.m3u8`). Le SDK ne fournit pas de lecteur :
utilisez celui de l'application, par exemple [hls.js](https://github.com/video-dev/hls.js),
ou la lecture HLS native de Safari.

```typescript
import Hls from 'hls.js';

const video = document.querySelector('video')!;
const url = stream.playbackUrl!;
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(url);
  hls.attachMedia(video);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = url; // Safari
}
```

Les événements temps réel du live (commentaires, réactions, spectateurs)
passent par `sdk.streamManager`, après `connectRealtime` :
`sdk.streamManager.joinStream(stream.id)` puis `onCommentNew`,
`onReactionBurst`, `onViewerCount`…

### Calls (REST)

Les routes d'appel exigent un jeton utilisateur : l'initiateur, celui qui
décroche ou qui raccroche est toujours l'utilisateur du jeton.

```typescript
const call = await sdk.calls.initiate({
  participantIds: ['other-user-uuid'],
  callType: 'video',
});

await sdk.calls.answer(call.id, { userId: 'user-uuid' });
await sdk.calls.decline(call.id, { userId: 'user-uuid' });
await sdk.calls.end(call.id, { userId: 'user-uuid' });

// Bascules média du participant (adressé par son identifiant)
await sdk.calls.setMuted(call.id, 'user-uuid', { muted: true });          // { muted }
await sdk.calls.setVideoEnabled(call.id, 'user-uuid', { enabled: false }); // { videoEnabled }
await sdk.calls.setScreenSharing(call.id, 'user-uuid', { sharing: true }); // { screenSharing }

// Serveurs STUN/TURN (identifiants TURN temporaires) et jeton LiveKit
const { iceServers, ttl } = await sdk.calls.getIceServers(call.id);
const { url, token, room, identity } = await sdk.calls.getLiveKitToken(call.id);

// Historique de l'utilisateur du jeton (pagination seulement)
const { calls, total, hasMore } = await sdk.calls.listHistory({ page: 1, limit: 20 });
```

Dans une application, préférez les gestionnaires d'appels ci-dessous : ils
pilotent le média et la signalisation.

### Encryption

Gestion des clés de chiffrement de bout en bout (protocole Signal).

```typescript
await sdk.encryption.registerKeys({
  identityKey: 'base64-identity-public-key',
  signedPrekeyId: 1,
  signedPrekey: 'base64-signed-prekey',
  signedPrekeySignature: 'base64-signature',
  prekeys: [
    { prekeyId: 1, prekey: 'base64-prekey-1' },
    { prekeyId: 2, prekey: 'base64-prekey-2' },
    // … une centaine conseillée
  ],
});

// Bundle du destinataire, pour établir une session
const bundle = await sdk.encryption.getPreKeyBundle('recipient-uuid');

// Réserve de prekeys de l'utilisateur du jeton
const { availablePrekeys } = await sdk.encryption.getPrekeysCount();
if (availablePrekeys < 25) {
  await sdk.encryption.uploadPrekeys({ prekeys: [/* nouvelles prekeys */] });
}
```

### Realtime

Événements WebSocket : messagerie, saisie, présence et notifications.

```typescript
sdk.connectRealtime(socketToken, { wsUrl: 'wss://api.example.com/events' });

const realtime = sdk.realtime!;
realtime.joinConversation('conv-uuid');

realtime.onMessageNew((msg) => console.log(msg.content));
realtime.onTypingUpdate(({ conversationId, userIds }) => { /* … */ });
realtime.onPresenceUpdate(({ userId, status }) => { /* … */ });

// Statut courant d'une liste d'utilisateurs
realtime.subscribePresence(['user-2', 'user-3']);
realtime.onPresenceStatus(({ statuses }) => {
  for (const { userId, status } of statuses) { /* 'online' | 'offline' */ }
});

// Accusés de lecture : passer de la simple à la double coche
realtime.onMessageRead(({ conversationId, userId, lastReadMessageId, readAt }) => {
  markRead(conversationId, userId, lastReadMessageId);
});

// Notifications lues sur un autre appareil
realtime.onNotificationRead(({ notificationIds }) => { /* … */ });
realtime.onNotificationAllRead(() => { /* … */ });
```

Les événements d'appel et de live passent par les gestionnaires dédiés
(`autoCallManager`, `callManager`, `groupCallManager`, `streamManager`), pas
par `realtime`.

## Appels audio et vidéo (navigateur)

Trois gestionnaires, liés au temps réel par `connectRealtime` :

- `sdk.autoCallManager` : point d'entrée recommandé, qui choisit le mode de
  chaque appel ;
- `sdk.callManager` : appels P2P (WebRTC, signalisation par WebSocket) ;
- `sdk.groupCallManager` : appels de groupe via le SFU LiveKit.

Leurs gestionnaires d'événements reçoivent les mêmes charges
(`onRemoteStream({ userId, stream })`, `onParticipantJoined`,
`onParticipantLeft`, `onMuteChanged`, `onVideoChanged`, `onCallConnected`,
`onCallEnded`, `onStateChanged`, `onError`).

### Point d'entrée recommandé : `autoCallManager`

Politique retenue : **le mode est décidé au démarrage de l'appel**
(`startCall`, `answerCall`), sur l'appel tel que l'API le renvoie.

- **Trois participants ou plus**, initiateur compris (les invités qui ont
  refusé comptent aussi) : LiveKit, via `groupCallManager`.
- **Sinon** : P2P, via `callManager`.

Appelant et appelés appliquent la même règle aux mêmes données et aboutissent
donc au même mode. `autoCallManager.mode` expose le choix (`'p2p'`, `'group'`,
ou `null` au repos et tant qu'un appel entrant sonne) ; la règle est aussi
exportée (`chooseCallMode`, `GROUP_CALL_MIN_PARTICIPANTS`).

**Le mode est fixé jusqu'à la fin de l'appel.** Un participant ajouté plus
tard à un appel P2P à deux n'est pas migré vers LiveKit : il n'y retrouverait
personne. Pour un appel de groupe, invitez tout le monde dès `startCall`.

```typescript
const sdk = new ApiCentral({
  baseUrl: 'https://api.example.com/s2s/v1',
  token: socketToken, // jeton utilisateur obtenu côté serveur
  wsUrl: 'wss://api.example.com/events',
});
sdk.connectRealtime(socketToken);

const calls = sdk.autoCallManager;
calls.onIncomingCall = async ({ callId, callerName }) => {
  if (await askUser(`Appel de ${callerName ?? 'inconnu'}`)) await calls.answerCall(callId);
  else await calls.declineCall(callId);
};
calls.onRemoteStream = ({ userId, stream }) => { videoFor(userId).srcObject = stream; };
calls.onParticipantLeft = ({ userId }) => removeVideo(userId);
calls.onCallEnded = ({ reason }) => closeCallScreen(reason);
calls.onError = ({ callId, error }) => console.error(callId, error);

await calls.startCall({ participantIds: ['user-2', 'user-3'], callType: 'video' });
console.log(calls.mode); // 'group'

await calls.toggleMute();
await calls.leaveCall(); // ou endCall() pour terminer pour tous
```

- Créé au premier accès, `autoCallManager` prend les gestionnaires
  d'événements de `callManager` et `groupCallManager` : n'en affectez plus
  directement à ces deux-là. Les siens survivent aux reconnexions du temps
  réel.
- Pendant un appel de groupe, un appel entrant est ignoré, comme par
  `callManager` pendant un appel.
- Le partage d'écran reste réservé aux appels P2P : `toggleScreenShare`
  rejette en appel de groupe.

### Appels de groupe (LiveKit)

- Installez `livekit-client` (^2.22). Sans lui, un appel de groupe échoue avec
  une erreur explicite ; le reste du SDK n'en dépend pas.
- Le SDK obtient l'URL du serveur LiveKit et un jeton d'accès par
  `GET /calls/{id}/token`. **N'écrivez jamais l'URL de LiveKit en dur** :
  elle vient de l'API.
- Décrocher rejoint la salle et publie le micro (et la caméra en vidéo)
  **avant** de décrocher côté API : si le média échoue, l'appel continue de
  sonner.
- L'API termine l'appel quand LiveKit signale que la salle est vide
  (`room_finished`) : les participants reçoivent `call_ended`.
- Si la connexion au SFU se ferme sans que le client l'ait demandé (réseau
  perdu, même utilisateur connecté depuis un autre appareil), l'appel se
  termine en local (`onCallEnded`, raison `sfu_disconnected`, et `onError`),
  sans prévenir l'API.
- Le SDK charge `livekit-client` par un `import()` dynamique, placé dans un
  bloc `try` : esbuild (Vite) bundle une application qui ne l'installe pas.
  Avec un autre bundler, si la résolution de `livekit-client` échoue alors
  que vous n'utilisez pas les appels de groupe, installez-le ou déclarez-le
  externe.

### Appels P2P : `callManager`

```typescript
sdk.callManager.onIncomingCall = ({ callId }) => sdk.callManager.answerCall(callId);
sdk.callManager.onRemoteStream = ({ userId, stream }) => { videoFor(userId).srcObject = stream; };
sdk.callManager.onError = ({ error }) => console.error(error);

await sdk.callManager.startCall({ participantIds: ['user-2'], callType: 'video' });
await sdk.callManager.toggleVideo();
await sdk.callManager.endCall();
```

`startCall` et `answerCall` exigent le temps réel branché
(`connectRealtime`) : sans lui, la signalisation serait perdue.

### Erreurs

- Les méthodes attendues rejettent leur promesse. `toggleMute`, par exemple,
  rejette si l'API n'a pas pu être notifiée ; l'état local reste appliqué.
- Un échec au démarrage ramène le gestionnaire au repos, média libéré ; un
  appel déjà créé est terminé côté API.
- `endCall`, `leaveCall` et `declineCall` libèrent le média même si l'API
  échoue, puis rejettent.
- Les erreurs survenues en arrière-plan (signalisation, connexion WebRTC en
  échec) passent par `onError({ callId, error })`.

### Serveurs ICE et identifiants TURN

- L'API renvoie les serveurs STUN/TURN de sa configuration, avec des
  identifiants TURN temporaires (coturn en `use-auth-secret`) valables `ttl`
  secondes (86400 par défaut).
- `callManager` les récupère à chaque `startCall` et `answerCall`. Il n'y a
  plus de STUN public de secours : si l'API ne répond pas, l'appel échoue
  clairement.
- Si vous créez vous-même vos `RTCPeerConnection` avec
  `sdk.calls.getIceServers(callId)`, utilisez les serveurs tels quels et
  redemandez-les avant l'expiration de `ttl`.
- Les appels de groupe n'en ont pas besoin : LiveKit fournit sa propre
  configuration ICE.

## Gestion des erreurs

```typescript
import { ApiCentralError } from '@api-central/sdk';

try {
  await sdk.users.get('invalid-uuid');
} catch (error) {
  if (error instanceof ApiCentralError) {
    console.error('Erreur API :', error.message);
    console.error('Code HTTP :', error.statusCode);
    console.error('Type :', error.error);
    console.error('Détails :', error.details);
  }
}
```

## TypeScript

Le SDK est écrit en TypeScript et exporte tous ses types :

```typescript
import type {
  User,
  Conversation,
  MessageResponse,
  StreamStats,
  CallMode,
  RemoteStreamEvent,
  // … tous les types sont exportés
} from '@api-central/sdk';
```

## Tests

```bash
npm test                  # tests unitaires (fetch, WebSocket et média simulés), sans serveur
npm run typecheck         # tsc, dont les tests de typage de src/__tests__/types.test-d.ts
npm run test:integration  # tests d'intégration contre une API locale
npm run test:all          # les deux
```

### Tests d'intégration

Ils s'exécutent contre un vrai serveur, et créent puis suppriment de vraies
données (utilisateurs, conversations, messages, notifications, lives,
appels). Prérequis :

1. L'API Rust sur `http://localhost:3004`, avec Postgres, Redis et RabbitMQ.
2. Une application de test dont la clé, le secret et l'identifiant
   correspondent à `TEST_CONFIG`, en tête de `src/__tests__/integration.test.ts`.
3. Un modèle de notification pour le test d'envoi par modèle. Les modèles
   n'ont pas de route de création : insérez-le directement.

```sql
INSERT INTO notification_templates
  (application_id, name, slug, title_template, body_template, channels)
VALUES
  ('<your-test-application-id>', 'SDK Integration Test', 'sdk_integration_test',
   'Message de {{sender}}', '{{sender}} : {{preview}}', ARRAY['in_app'])
ON CONFLICT (application_id, slug) DO NOTHING;
```

La suite couvre aussi le WebSocket : elle ouvre une vraie connexion sur
`ws://localhost:3004/events`, rejoint une conversation et vérifie la
réception de `message_read` et `message_new`.

## Notes d'alignement sur l'API

- **Les clés des réponses sont converties en camelCase.** L'API parle
  snake_case : le client convertit corps et paramètres en snake_case, et les
  réponses en camelCase. `sent_count` arrive en `sentCount`.
- **La catégorie d'une notification s'appelle `type`, pas
  `notificationType`.** La requête prend `notificationType`, la réponse
  renvoie `type`.
- **Les modèles de notification sont en lecture seule depuis le SDK.**
- **Certaines routes prennent l'utilisateur dans le jeton, pas en
  argument** : les routes d'appel, `calls.listHistory` et
  `encryption.getPrekeysCount` exigent un jeton utilisateur.
- **Les réactions de live sont limitées en débit par utilisateur.**
  `sendReaction` renvoie `{ accepted, message }`, et `retryAfterMs` quand la
  limite est atteinte : vérifiez `accepted` plutôt que de supposer le succès.
- **`listStreams` renvoie un tableau** et ne filtre que par `status` (`live`
  par défaut), avec la pagination ; il n'existe pas de filtre par hôte.
- **`getStats` renvoie des compteurs et les réactions par emoji**, sans
  statistiques de visionnage (vues totales, temps moyen).

## Licence

MIT
