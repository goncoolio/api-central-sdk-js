# Journal des modifications

## 2.0.0

Alignement sur l'API Central S2S et sur la pile média déployée en production
(coturn, LiveKit, SRS), et appels de groupe via LiveKit.

### Changements incompatibles

- **Node.js 22 ou plus récent est requis** (`engines.node`). Le temps réel
  utilise le `WebSocket` global, absent de Node.js 18 et 20 ; sans lui,
  `WebSocketClient` et `connectRealtime` lèvent une erreur explicite.
  `callManager`, `groupCallManager` et `autoCallManager` sont réservés au
  navigateur ; les modules REST et le temps réel fonctionnent sous Node.js.
- **`live.getStats()`** renvoie le `StreamStats` réel de l'API :
  `streamId`, `viewerCount`, `peakViewerCount`, `totalComments`,
  `totalReactions`, `reactionsByEmoji` et `durationSeconds` (`null` avant le
  démarrage). Les champs `totalViews`, `uniqueViewers`, `peakViewers`,
  `averageWatchTime` et `duration` n'existaient pas côté API et disparaissent.
- **`live.listStreams()`** n'accepte plus `hostId` : l'API l'ignorait. Les
  options sont `ListStreamsQuery` (`status`, `page`, `limit`), et seuls ces
  paramètres sont envoyés.
- **`realtime.onPresenceStatus()`** reçoit l'événement `{ statuses }`
  (`PresenceStatusEvent`) au lieu d'un tableau nu.
- **`PresenceStatus`** perd `'busy'`, que l'API ne documente ni ne produit.
- **`CallManager` notifie l'API avec l'identifiant réel de l'utilisateur**
  (`/calls/{id}/participants/{userId}/…`, au lieu de `me` que l'API refusait).
  L'identifiant vient de `callManagerConfig.userId`, du jeton utilisateur ou
  de l'événement WebSocket `connected`. `toggleMute`, `toggleVideo` et
  `toggleScreenShare` rejettent désormais si l'API n'a pas pu être notifiée,
  au lieu d'avaler l'échec ; l'état local reste appliqué.
- **`CallManager` remonte ses erreurs** au lieu de les avaler :
  - `startCall` et `answerCall` rejettent si le média, l'API ou les serveurs
    ICE échouent, et reviennent au repos. Plus de STUN Google de secours codé
    en dur : un échec de `GET /calls/{id}/ice-servers` rejette. Un appel déjà
    créé est terminé côté API.
  - `startCall` et `answerCall` exigent le temps réel branché
    (`connectRealtime`).
  - `endCall`, `leaveCall` et `declineCall` libèrent le média même si l'API
    échoue, puis rejettent.
  - `toggleScreenShare` ne renvoie `false` que si l'utilisateur ferme le
    sélecteur ; les autres échecs de capture rejettent.
  - Les échecs de signalisation en arrière-plan et une connexion WebRTC en
    échec passent par le nouveau `onError`.
- **`CallManager` ignore les événements des autres appels** : un
  `call_ended` ou une offre SDP d'un autre appel ne touche plus l'appel en
  cours, et la négociation n'a lieu qu'une fois l'appel rejoint.
- **Réponses des bascules média typées** : `calls.setMuted` renvoie
  `{ muted }`, `setVideoEnabled` `{ videoEnabled }`, `setScreenSharing`
  `{ screenSharing }` (au lieu de `{ success }`).

### Nouveautés

- **Appels de groupe via LiveKit** : `GroupCallManager` (navigateur,
  `sdk.groupCallManager`) rejoint la salle LiveKit d'un appel avec l'URL et
  le jeton renvoyés par l'API, publie le micro (et la caméra en vidéo), et
  expose participants et flux distants avec les mêmes événements que
  `CallManager`.
- **`calls.getLiveKitToken(callId)`** : `GET /calls/{id}/token`, qui renvoie
  `{ url, token, room, identity }` (`LiveKitTokenResponse`).
- **`AutoCallManager`** (`sdk.autoCallManager`), point d'entrée unique :
  le mode est choisi au démarrage de l'appel, LiveKit dès trois participants
  (initiateur compris), P2P sinon ; `mode` expose le choix. La politique est
  aussi exportée : `chooseCallMode`, `GROUP_CALL_MIN_PARTICIPANTS`, `CallMode`.
- **`livekit-client` ^2.22** devient une peerDependency facultative, chargée à
  la demande.
- `CallManager` : `onError`, `localUserId`, `setLocalUserId()`,
  `startExistingCall()` et `dismissIncomingCall()`.
- L'identifiant de l'utilisateur local est déduit du jeton utilisateur
  (constructeur, `setToken`, `connectRealtime`).
- `IceServersResponse` expose `callId` et `ttl`, durée de validité des
  identifiants TURN.
- `live.sendReaction()` renvoie `StreamReactionResponse`, avec `retryAfterMs`
  quand la limite de débit est atteinte.
- Types exportés : charges des événements d'appel (`CallConnectedEvent`,
  `CallEndedEvent`, `RemoteStreamEvent`…), `PresenceStatusEvent`,
  `PresenceStatusItem`, `ListStreamsQuery`, `GroupCallManagerConfig` et
  l'adaptateur `GroupCallRoom`.

### Corrections

- `calls.sendOffer` et `sendAnswer` envoient `sdp_type`, champ exigé par
  l'API : ils échouaient systématiquement.
- `onPresenceStatus` tolère un serveur antérieur au correctif de l'API, qui
  omettait la liste des statuts.
- Exemples JSDoc corrigés : `calls.initiate` (pas d'`initiatorId`),
  `auth.getToken` (`accessToken`) et `auth.getUserToken` (`socketToken`,
  `user`).
