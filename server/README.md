# Pool real-time server

Deploy this directory as a standalone Node.js service on Render or Railway. Set the service root to `server`, install with `npm install`, and start with `npm start`. No build step is needed. Node 22 or newer is required. The service listens on all network interfaces using the platform's `PORT` (8080 when unset, matching the Railway target port), logs the listening port and version at startup, and exposes `/health` as the health check. `/version` returns `pool-lobby 8-ball v55` (v55 adds custom-sized, resizable hotels and hotel finances); if it returns `Not found` or an older version, the platform is running an outdated copy of this server. On Railway, use the `garrdetto/thelibrary` repo, the `main` branch, root directory `server`, start command `npm start` and target port 8080.

Set `FRONTEND_ORIGIN` to the exact HTTPS frontend origin, currently `https://thelibrary.garrdetto.workers.dev`. Multiple trusted production or preview origins can be comma-separated. When configured, requests from other origins are rejected. When unset or empty, only `https://thelibrary.garrdetto.workers.dev` is accepted (v39 default). Configure explicit origins in production. In the site's Cloudflare build variables, set `VITE_POOL_SERVER_URL` to this service's public HTTPS URL, then redeploy the frontend. This public URL is compiled into the client; it is not a secret. When unset, the frontend uses its existing default service URL; signed-in solo practice remains available if multiplayer is offline.

Run one server instance. Lobbies, invitations and active matches are transient session state: restarting the server ends them. There is no saved match history or personalization persistence. Horizontal scaling requires a shared Socket.io adapter and shared room coordination before adding replicas.

Open the frontend in two browsers and sign in with different workspace accounts. Each connection receives a fresh account ticket and rejoins with the verified username. The server keeps every active player in memory as `{ socketId, username, status, room }` and rejects names that are invalid, already taken (case-insensitive) or on its profanity list. A connection from the same verified account replaces its previous connection instead of being reported as a duplicate.

Lobby events: the client sends `set-username` (the legacy `join` event is accepted as an alias), `set-status` (`available` or `away`, sent after 5 minutes without interaction), `send-invite` `{ username }`, `respond-invite` `{ id, accept }` and `leave`. The server replies with `username-accepted` / `username-rejected`, broadcasts the full `players` list (`{ username, status }`, statuses `available`, `in-game`, `away`) to everyone in the lobby whenever anyone joins, leaves or changes status, and drives invitations with `invite-sent`, `invite-received`, `invite-declined`, `invite-expired`, `invite-cancelled` and `invite-error`. Accepting creates a room such as `room_7y2H9`, joins both sockets to it, marks both players in-game and emits `game-start`. Challenges expire after 30 seconds, a player can have up to three outgoing challenges, and players who are in a game cannot be invited. The challenger breaks.

Chat: the client sends `send-chat-message` `{ text }`. The server trims it to 280 characters, masks blocked words, allows one message every 0.7 seconds, and delivers `receive-chat-message` `{ id, type, scope, from, text, at }`. `type` is `player` or `system`; `scope` is `lobby` (everyone in the lobby who is not at a table) or `table` (only the two players in the room). System messages announce joins (“Player 1 has joined”), departures, renames, who breaks, group assignments, scratches and results. The last 30 lobby messages are replayed to players who join or return from a table.

8-ball rules: each room keeps a game state, sent to both players as `game-state` (and embedded in `game-start` as `state`): `{ roomId, tableStatus, activeTurnPlayerID, players: [{ id, username, group, remaining }], eightOnTable, winner, winnerID, result, ballInHand, foul, cueDesigns }`. `tableStatus` starts as `OPEN`. Any object ball may be hit first on the opening break; afterward, an open table permits a solid or stripe as first contact, but not the 8-ball. Break pots keep the table open and let the breaker continue without fouling. The first player to pot an object ball (not the 8-ball) on a later shot without fouling takes that ball's group (`solids` 1–7 or `stripes` 9–15) and the opponent gets the other; the status becomes `ASSIGNED`. Potting one of your own group balls without fouling keeps the turn; otherwise the turn passes. Clearing all seven group balls and then potting the 8-ball wins. Potting the 8-ball while any of your group remain (including on an open table) loses, as does any foul on the same shot as the 8-ball. `activeTurnPlayerID` is the socket id of the only player allowed to shoot, and is `null` once the game is over. Finished rooms stay open for chat until a player leaves. Only the current striker can submit a shot and its final snapshot. Each accepted shot is sequenced, broadcasts its vector, power and English to both clients, and locks the next shot until the striker publishes all 16 ball records, including pocketed markers, plus `scratch`, the `order` balls dropped in, `firstContact`, `railAfterContact`, and `offTable`. Balls the server already counts as pocketed stay pocketed. The server validates membership, turn, coordinates, unique ball IDs and shot ranges. Positions come from the striker, so this is not an anti-cheat physics server.

A disconnect ends the room and notifies the other player. Reconnecting players join again; old games are not resumed. A shot that fails to settle within 90 seconds ends its room. Test declined/expired invitations, duplicate names, disconnections, scratch recovery, turn blocking and final position correction during deployment verification.

The v11 client and server must be deployed together for combined foul, ball-in-hand, and custom cue support. Deploy the Netlify frontend and redeploy this standalone service on its hosting platform as well. The `/version` response should report `pool-lobby 8-ball v11`.

Game state includes `ballInHand` (the entitled socket ID or null) and `foul` (the latest shot’s reason or null). Scratches, no contact, wrong first contact, a ball leaving the table, and no pot or cushion after contact pass the turn with ball in hand. A foul while pocketing the 8-ball loses the game. These remain browser-reported physics events rather than server-simulated anti-cheat enforcement.

The entitled player may repeatedly drag the cue ball or hand indicator before shooting; arrow keys on the focused canvas also move it. Reliable `cue-position` updates share changed positions during dragging and keyboard placement, with a final update on release, so the opponent sees placement before the shot. The opening breaker also has ball in hand, restricted to the kitchen behind the head string (x ≤ 290), just as in practice. Game state identifies this restriction with `ballInHandRegion: "kitchen"`; later fouls use `"table"`. The server starts with the same rack as the clients so opening placements can be validated. The server validates these positions with the same checks used for shots. Aim updates use their own 75 ms throttle; the client sends changed placement at most once per 110 ms during movement and confirms placement on release. Neither update consumes the lobby/action request allowance. The next shot includes `cuePosition`, which the server checks against entitlement, felt bounds, pocket clearance, and other balls before broadcasting the placement with the shot to both browsers. Placement does not consume ball in hand; an accepted shot does. A `shot-rejected` response unlocks the client for another attempt.

Cue sharing uses match-scoped `cue-design` updates and rate-limited `cue-aim` updates. Designs include validated colors, a preset identifier, and an optional small PNG wrap. Only room members can exchange designs; only the active player can broadcast aim while a shot is not pending. The server relays these updates to the opponent without persisting uploaded images or adding them to lobby messages. Deploy server v11 alongside the frontend to enable opponent cue display.

Preset team artwork is bundled with the frontend from ESPN’s static team-logo collection: `mlb/500/mil.png` (Brewers), `ncaa/500/275.png` (Wisconsin), `nba/500/mil.png` (Bucks), and `mlb/500/chc.png` (Cubs), under `https://a.espncdn.com/i/teamlogos/`. Presets repeat these images in the cue wrap; no external image requests are needed during play.

Server v11 acknowledges saved cue updates and keeps each participant’s design in the transient match snapshot. Every turn-state update includes both designs, so clients select the cue by active player ID and retain it throughout the match. Designs are discarded with the room; permanent appearance storage remains on Netlify. The frontend reports whether the current opponent has received the saved cue.

## Overdrive Racing

This service also hosts the `/racing` Socket.io namespace. Redeploy the `server` directory with the frontend release to enable Racing; Netlify Functions cannot host persistent Socket.io connections. It uses the existing public server URL setting and requires `FRONTEND_ORIGIN` to include the exact frontend origin, including any preview origins used for multiplayer. Without a configured list, Racing only accepts the production frontend origin. Pool also requires a trusted frontend origin and a verified account ticket.

Racing requires the same Netlify Identity account as the Garage. The frontend obtains a one-use, 60-second connection ticket from Netlify. The server redeems it against the trusted frontend before admitting the socket; account names and saved schemes come from the verified profile. Tickets are hashed in Netlify Database and consumed atomically. No additional service credentials are required. Garage profiles persist in Netlify Database and generated textures in private Netlify Blobs, served through an ownership-checked endpoint. Applied migrations remain unchanged; the new Racing migration is applied by Netlify at deployment.

The Racing namespace hosts one shared, transient race at a time. A host chooses AI strength from 0–100 and invites everyone currently connected to the lobby. Entries close after 30 seconds; at least two human players must enter or the invitation is cancelled. The grid contains 24 cars, with randomized AI filling unused places. Each human driver has a distinct name color. A three-second countdown precedes the three-lap race. All authenticated lobby connections receive snapshots, including late arrivals who watch rather than enter. Disconnected or withdrawn racers are driven by AI; remaining players continue. Races end when all cars finish or after ten minutes. Run exactly one service instance to preserve the single-race guarantee. No persistent lobby data is stored; profiles and lap records remain in Netlify Database.

Time Attack runs locally with one human car and no lap limit. Start Game retains configurable practice opponents and three laps. Record queries filter by practice, time-attack, or multiplayer before selecting the top ten. Existing records retain their original modes and dates.

Generated textures are private to the owning account. The owner sees their texture on the canvas; opponents see the corresponding base racing car. Changes to the Garage require reconnecting to the Racing lobby, so the server reloads the selected profile before the next race.

The updated circuit runs in the opposite direction on a rounded, curved centerline. Steering is 25% weaker and all liveries and AI use the same speed cap and acceleration model. Wall contact guides cars along the road, and iterative solid-car separation replaces position rollbacks. Contact penalties are 10% with a cooldown so sustained three-car contact does not repeatedly drain speed. Redeploy this service with the updated frontend to use the new course, collision behavior, and per-car lap-time snapshots in multiplayer.

Individual human laps from either mode are submitted by the signed-in browser to Netlify Database. The record books select the ten fastest individual laps, including multiple laps by the same driver, with server-assigned recording dates. Submissions derive the username from Identity, validate bounded times, and deduplicate run/lap submissions. Practice and multiplayer record submissions are browser-reported; the public records are not a tamper-proof competitive leaderboard. AI opponents are excluded. Existing records remain on the previous course if the circuit changes again.


## Fresh accounts and unified login

Deploy server v11 with the account update. The `/version` endpoint reports `pool-lobby 8-ball v11`. Pool now requires a short-lived, single-use account ticket from `/api/pool-account`; the server redeems it against the trusted frontend before accepting a connection. Browser-supplied names cannot override the verified account username. Existing v10 servers do not enforce this authentication, so redeploying the standalone service is required.

The inline username/password form signs in existing users and creates password-protected accounts for new usernames. The first game account request on a production deploy performs the requested one-time reset of pre-reset Identity accounts, Pool preferences and cue wraps, racing profiles and skins, connection tickets, and lap records. It records a durable cutoff and completion marker in Netlify Database, serializes concurrent resets, and retries incomplete cleanup before admitting players. Accounts created after the cutoff are preserved. Subsequent deployments keep the completed marker and preserve new settings. Preview deployments do not delete shared Identity accounts or image stores. Studio creations and lyric corrections remain unchanged.

The password setup and lobby-name dialogs were removed. Account identity supplies lobby names, and invitations and status messages appear inline. Guests cannot open the Pool table or access its saved customization endpoints.

The current racing update enlarged cars and collision footprints by a further 33% and increased the shared top-speed scale by 30%. Practice supports zero through 23 AI opponents (24 cars total) with a staggered two-column grid sized for the larger vehicles. Position boosts are 0%, 5%, 7%, 9%, and 11% for places 1–5, followed by a linear 12–20% across places 6–24, independent of field size. Gaining places tapers the previous boost and its associated speed contribution to the new position's level over three seconds. Redeploy this standalone service alongside the frontend so multiplayer uses the same shared physics and boost schedule.

The latest circuit update tightened and narrowed the final corner before the main straight. Car contacts now used impact location, relative closing speed, and rotational inertia to produce damped yaw instead of a fixed steering kick. Redeploy this standalone service alongside the frontend so multiplayer uses the same course and contact response as practice. Existing lap records were preserved.

## Oval Speedway

Server v12 adds a second racing track. `create-race` accepts an optional `track` of `circuit` (default) or `oval`; the room state and `start` payload include `track`, and the shared race engine simulates that track's geometry with the same physics, AI, boosts and contact rules. Clients render the oval with clipart stock cars and use the track from the server's `start` payload. Older servers reject oval invitations, so redeploy this service alongside the frontend; `/version` then reports `pool-lobby 8-ball v12`. Lap records are stored per track and mode.

Server v13 replaces the Oval Speedway geometry with the aerial speedway artwork (start/finish at bottom center) and rebuilds the shared racing AI. AI drivers steer by pure pursuit, follow a speed profile computed from track curvature, and on the oval follow a precomputed minimum-curvature groove (high on the straights, low through the turns) weighted by AI strength. AI strength is 25% harder across the whole slider, and parked finishers no longer collide with cars still racing. Redeploy this service alongside the frontend so multiplayer races use the same geometry and AI; `/version` then reports `pool-lobby 8-ball v13`.

Server v14 races a single customizable stock car on Oval Speedway. Oval cars are one quarter of the track's narrowest width between the white lines (four fit side by side), with a longer collision footprint matching the artwork. Player schemes may include `stockCar` `{ body, stripe, accent, number }`; AI cars get random stock-car paint and numbers. Car-to-car contact now yaws both cars 50% more on both tracks. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v14`.

Server v15 changes Oval Speedway physics in the shared race engine. The white lines are gone: the outer edge is now a wall whose impact costs 5–15% speed depending on how directly the car hits it, and the inner edge is a run-off zone whose slowdown is 60% weaker (up to 24% instead of 60%). Oval cars are 35% larger and the oval top speed is 15% higher. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v15`.

Server v16 moves the Oval Speedway outer wall in the shared race engine out to the tan outline at the edge of the track artwork, 20 units beyond the previous wall, so cars can use the full width of the asphalt. The separately drawn white wall is gone. The inner edge and Max Secure Circuit are unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v16`.

Server v17 removes the Oval Speedway inner wall in the shared race engine. Cars can now leave the inside edge of the track onto the infield; instead of a wall, they slow down by 5% as soon as any part of the car crosses the inside edge, ramping linearly to 20% once the car is a full car width past the edge (12.5% at half a car width). The outer wall and its speed penalty are unchanged, as is Max Secure Circuit. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v17`.

Server v18 shrinks the turning radius of Oval Speedway cars by 10% in the shared race engine (steering turns them about 11% faster at any speed, and the AI's cornering speeds account for it). The infield slowdown from v17 is unchanged: 5% at the inside edge, rising linearly to 20% at a full car width off the track. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v18`.

Server v19 makes Oval Speedway cars 15% faster and widens their turning radius by 15% in the shared race engine (top speed scale 1.15 → 1.3225, turning radius scale 0.9 → 1.035, so steering turns them about 13% slower at any speed; the AI's speed profile and cornering speeds account for both). The infield slowdown and outer wall are unchanged, as is Max Secure Circuit. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v19`.

Server v21 changes Oval Speedway handling in the shared race engine. The turning slowdown is 25% stronger (6.25% when steering starts, ramping to 62.5% after one second of held steering, instead of 5% to 50%). Touching the infield now locks steering: while any part of the car is over the inside edge, and for 0.5 seconds after the car is fully back on the track, steering input is ignored and the car drives straight in the direction it is facing. The infield slowdown, outer wall and Max Secure Circuit are unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v21`.

Server v22 lets the host choose the lap count for Oval Speedway races. `create-race` accepts an optional `laps` (whole number from 1 to 50, default 3); it applies only to the oval, and Max Secure Circuit stays at 3 laps. The room state and the `start` event now include `laps`, and the race safety timeout scales with the lap count. The shared race engine also strengthens the oval infield steering lock: steering now stays locked for 1.5 seconds (was 0.5 seconds) after the car is fully back on the track. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v22`.

Server v23 makes every car 15% faster at top speed and reduces steering strength by 10% on both tracks in the shared race engine (top speed scale gains a ×1.15 factor and a new `STEERING_STRENGTH_SCALE` of 0.9 applies to player, multiplayer and AI steering). Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v23`.

Server v24 retunes Oval Speedway cars in the shared race engine; Max Secure Circuit is unchanged. The v23 changes are reverted on the oval only (no extra ×1.15 top speed, full steering strength), and the infield steering lock from v21/v22 is removed, so cars can always steer on the infield (the infield slowdown remains). Oval top speed is then 35% higher (speed scale 1.15 × 1.35 = 1.5525), throttle acceleration is 35% quicker (time constant 1.2 s ÷ 1.35), and when the accelerator is released the car coasts down at half the previous rate (time constant 1/0.65 s doubled). The AI's speed profile and cornering speeds account for the new values. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v24`.

Server v25 makes a turn tap on Oval Speedway cut speed by 12% in the shared race engine (was 6.25%), via a new `turnTapPenalty` track option. Holding a turn still ramps the slowdown to 62.5% over one second. Max Secure Circuit is unchanged (5% tap, 50% held). Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v25`.

Server v26 retunes Oval Speedway cars in the shared race engine: `speedScale` 2.3 (was 1.15×1.35), `accelerationScale` 1.7 (was 1.35) and `turnRadiusScale` .75 (was .9×1.15), giving higher top speed, quicker acceleration and tighter turning. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v26`.

Server v27 retunes Oval Speedway cars again in the shared race engine: `speedScale` 2.1 (was 2.3), `accelerationScale` 1.3 (was 1.7) and `turnRadiusScale` .6 (was .75), giving a slightly lower top speed, gentler acceleration and tighter turning. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v27`.

Server v28 makes Oval Speedway cars 25% larger in the shared race engine: the oval's `laneFraction` (car width as a fraction of the narrowest track width) is now .421875 (was .25×1.35 = .3375). Collision footprints and the AI's spacing scale with the car. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v28`.

Server v29 tightens Oval Speedway handling and penalties in the shared race engine. The oval's `turnRadiusScale` is now .4 (was .6), so cars turn tighter. Outer wall impacts are 50% stronger, costing 7.5–22.5% speed (was 5–15%) depending on how directly the car hits. The infield slowdown is 50% stronger, starting at 7.5% when any part of the car crosses the inside edge and ramping to 30% at a full car width off the track (was 5–20%). Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v29`.

Server v30 widens Oval Speedway turning in the shared race engine: the oval's `turnRadiusScale` is now 1 (was .4), so oval cars turn with a wider radius, about 10% tighter than circuit cars because of their stronger base steering. Max Secure Circuit and all penalties are unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v30`.

Server v31 makes Oval Speedway cars 10% smaller and accelerate 20% slower in the shared race engine: the oval's `laneFraction` is now .3796875 (was .421875) and `accelerationScale` is now 1.04 (was 1.3). Collision footprints and the AI's spacing scale with the car. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v31`.

Server v33 doubles the initial steering slow-down on Oval Speedway in the shared race engine. The moment a turn key is pressed, grip now drops by 24% instead of 12%, then still builds to the same 62.5% maximum over one second of held steering. Max Secure Circuit is unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v33`.

Server v32 changes Oval Speedway lap counting in the shared race engine. Instead of passing every checkpoint in order, a car must cross an imaginary half-way line on the far straight, opposite the start/finish line, before crossing the finish line again. Both lines reach from the outer wall to the center of the infield, so laps with infield or wall penalties still count, and race positions follow each car's distance around the oval. Max Secure Circuit keeps ordered checkpoints. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v32`.

Server v34 makes the shared racing AI 25% harder across the whole AI strength slider on both tracks (AI skill now runs from 0.25 to 1.25 instead of 0.2 to 1), and AI drivers now notice a car alongside on the inside as they approach a corner. Lower AI strength usually leaves room by moving out and easing off; higher strength rarely does, and from about 90 up they always hold their line. Car-to-car contact has less resistance: touching cars lose 4% grip instead of 10%, a hit from behind passes much of the closing speed to the car in front and makes it wiggle briefly, and a hit on the left or right rear pushes the rear of the car in the direction of the hit, with a short sideways slide that slightly upsets the handling. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v34`.

Server v35 gives every race a rolling start and raises the car-to-car contact grip loss to 20% in the shared race engine. During the three-second countdown the field is paced around the track in its grid order, two abreast, at a steady speed. That speed is 30% of top speed, lowered if needed for the corners before the line. The leader reaches the start/finish line just as the countdown ends, and every car is already moving when control is handed over. Cars no longer start from a standstill and pile up at the start. Touching cars now lose 20% grip (was 4%); the push, wiggle and rear-slide effects from v34 are unchanged. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v35`.

Server v36 scales the contact handling effects with the contact grip loss in the shared race engine. The wiggle after a hit from behind, the rear swing from a hit on a rear quarter, and the sideways slide are each multiplied by the grip loss divided by 8%. At the current 20% grip loss that makes them 2.5 times stronger than in v34, and they follow automatically if the grip loss changes. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v36`.

Server v37 doubles the Oval Speedway infield slowdown in the shared race engine: 15% as soon as any part of the car crosses the inside edge, rising linearly to 60% at a full car width off the track (was 7.5% to 30%). The outer wall and Max Secure Circuit are unchanged. On both tracks, for the first 2.5 seconds after the rolling start ends, AI cars hold their grid lane and accelerate to their cornering speed without braking for traffic, so the pack spreads out instead of jamming. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v37`.

Server v38 makes racing AI drivers 50% stronger in the shared race engine at every AI strength setting: the internal strength derived from the 0–100 slider is multiplied by 1.5, which sharpens their lines, braking, cornering speed, reaction time and overtaking, and makes them less willing to yield. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v38`.

## Site-wide presence and invites

Server v20 keeps every signed-in browser in the pool lobby on any page of the site, so players show as online in both games. The client sends `set-activity` (`pool`, `racing` or `site`) when it changes pages, and each `players` entry now includes `game` (`pool`, `racing` or `null`) and `playing` (true while seated at a pool table or driving in a running race; racing status comes from the `/racing` namespace on the same server). Pool challenges reach players wherever they are on the site. When a racing invitation opens, every other signed-in player receives `race-invite` `{ id, from, track, expiresIn }` on the main namespace, and `race-invite-closed` `{ id }` when entries close or the invitation ends. Any authenticated `/racing` connection may now enter while entries are open, so players can accept from another page and connect within the 30-second window. Redeploy alongside the frontend; `/version` then reports `pool-lobby 8-ball v20`.

## Thrill Park (v40)

This service also hosts the `/park` Socket.io namespace for the Thrill Park theme-park game. Redeploy the `server` directory with the frontend release; `/version` should report `pool-lobby 8-ball v40`. The simulation lives in `server/park/` and is shared with the browser, so single-player and online parks run identical rules. Any change to `server/park/` requires redeploying this service.

Players connect with a one-use ticket from `/api/park` (action `ticket`), which the server redeems at `<site>/api/park?action=redeem`. Up to 12 parks run at once, each with up to four players.

- **Co-op** rooms start immediately from a scenario or from a compressed save (base64 gzip, at most 180 KB). Everyone manages park 0 and can drop in while it runs.
- **Versus** rooms wait for two to four players. The host starts the match on the Twin Valleys map, each player gets their own park, and the highest company value at the end of year two wins. Only the host can change speed.

The server is authoritative. It steps the simulation at 20 Hz (scaled by game speed). Every accepted command is broadcast as `cmd` with the resulting `nextId` and `structVersion`, so clients replay structural changes in the same order. A `dyn` snapshot goes out every 250 ms: time, finances, rides, stalls, staff, litter, new news, and guests packed as an `Int32Array` (three integers per guest). A client whose replay drifts sends `resync` and receives a fresh `init`. Other events: `create`, `join`, `start`, `command`, `guest` (guest detail), `export` (full park for saving to the player's own account), `chat` (one message per 0.7 s, 200 characters) and `leave-room`. Commands are limited to 25 per second and 2 KB each. Parks are transient: restarting the server ends them, and players keep progress by saving to their account.

### Thrill Park v41

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Right turns now curve clockwise and bank into the turn. The loop radius is 6.5 m.
- Coasters can have extra stations, where trains stop for 4 seconds and drive tires launch them back out.
- New `finish` (auto-route the track back to the station) and `preset` (place a ready-made design) commands.
- New flat rides: go-karts, a swimming pool and a waterslide. Guests favour water rides on hot days and avoid them in rain.

### Thrill Park v42

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Months now last ten days, and standard parks can borrow up to $50,000.
- Ordinary footpaths can be assigned and repainted to custom colors.

### Thrill Park v45

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Standard maps start with the same park footprint and can expand to four times its area by buying adjacent squares for $100 each.
- Unpurchased expansion land is tinted light red. Older 64-square park saves are expanded when loaded.
- Daily electricity now costs $1 per occupied ride or shop tile.

### Thrill Park v46

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Staff wages are $50 per day, and expansion land stays to the sides and behind the entrance.
- Coaster curves bank gradually, custom track sections ease steep slope changes, and Tempest Coasters can build corkscrews.
- Roller coasters use two trains with up to 10 cars each; ride track, support, and train colors are customizable.

### Thrill Park v47

Redeploy this service with the frontend so online parks run the same rules as solo play:
- The guest cap is four times the old ride-and-shop formula, limited by owned land (0.7 guests per owned square) and an overall maximum of 6,400 guests per park. The park panel shows which one is limiting the crowd.
- `buyLandArea` buys every eligible expansion square in a dragged rectangle (up to 32 by 32) that connects to the park, at $100 each.
- Scenario guest objectives are now 600, 1,000 and 1,500.
- When a park has more than 2,000 guests, guest positions are sent every other snapshot and large snapshots are compressed (`perMessageDeflate`, 8 KB threshold).

### Thrill Park v48

Redeploy this service with the frontend so online parks run the same rules as solo play:
- The Wave Pool (`wavePool`) and Swimming Pool take a dragged size (`flat` with `w`/`h`, 4×4 to 16×20 and 3×3 to 16×20). Cost, upkeep, capacity and excitement scale with area (`flatSpec` in `server/park/flatspec.mjs`).
- Wave settings Calm, Rolling, Surf and Storm (`rideSet` with `wave`) change the wave pool's excitement, intensity and nausea.
- Older saved pools keep their 5×4 footprint.

### Thrill Park v49

Redeploy this service with the frontend so online parks run the same rules as solo play:
- 15 new water rides in the Water tab: Body Slide Tower, Twin Tube Slide, Family Raft Slide, Bowl Vortex, Funnel Slide, Half-Pipe Boomerang, Trapdoor Speed Drop, Mat Racer, Aqua Loop, Surf Rider, Splash Pad, Kiddie Lagoon, Tipping Bucket Fort, Lily-Pad Activity Pool and Cliff Jump Platform.
- Guests want water rides more on sunny days (on top of the existing heat bonus) and skip them in rain.

### Thrill Park v50

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Ten compact ready-made coasters (`COASTER_PRESETS` entries with `footprint`, `height` and `cost`), each at most 16 squares on a side, that close their own circuit without auto-complete.
- Suspended Looper stations now start 3.5 m above the ground (`INVERTED_STATION_LIFT`), so the style can be built on flat land.

### Thrill Park v51

Redeploy this service with the frontend so online parks run the same rules as solo play:
- A quarter of adult guests are thrill seekers (`type: 'thrill'`, intensity limit 8–13). Other adults now accept 6–11.5; kids are unchanged.
- Guests warm up: each ride they enjoy raises their limit by 0.3, up to +2.5 (`warm`). Two or more nearby guests heading to the same intense ride let a hesitant guest join with +1.5 (`thrillCrowds`, refreshed every 20 ticks).
- Thrill seekers re-ride intense rides they love.
- Drop Tower 24 riders, Twister Arm 24, Zipper 28, Gravitron 36 (cost and upkeep raised by half the capacity increase). Launch, Tempest and Suspended coasters seat 6 per car.

### Thrill Park v52

Redeploy this service with the frontend so online parks run the same rules as solo play:
- Rides keep their last 12 guest comments (`comments`) and running counts by mood (`commentCounts`), recorded after each ride and when guests give up queuing, can't afford a ride, refuse one as too intense or too expensive, get stuck, or are turned away by a breakdown (`server/park/comments.mjs`).
- New socket request `ride-comments` `{ id }` answers `{ comments }` for the selected ride only; comments are not part of the regular snapshot.

### Thrill Park v56

Redeploy this service with the frontend; older clients cannot replay the new color commands:
- Ride colors are slots (`server/park/palette.mjs`): every ride has a main color, chase lights and glow lights, plus ride-specific parts (`RIDE_SLOTS`, `COASTER_SLOTS`). `rideSet` takes `colors` (slot key → `#rrggbb`, `null` to clear one or all) and `scheme` (0–2 or `null`); `rideColors` resolves custom colors, then the park scheme, then the legacy `color`/`trackColor`/`supportColor`/`trainColor`, then the slot default. Coasters keep the legacy fields in step.
- Each park has three editable color schemes (`schemes`, defaults `DEFAULT_SCHEMES`), changed with `park` `{ scheme: { index, name?, colors? } }`; rides using a scheme follow its edits. Snapshots carry `colors` and `scheme` per ride.

### Thrill Park v55

Redeploy this service with the frontend; older clients cannot replay the new hotel commands:
- Hotels can be any footprint between each style's `min` and `max` (now up to 24 squares a side, `HOTEL_SIZE_LIMIT`) and wider floor ranges (up to 32 for Skyline Tower). Build cost is base + squares × floors, with a 2% per-floor premium above 8 floors.
- New command `hotelResize` (`id`, `w`, `h`, `floors`) grows or shrinks a hotel in place from its north-west corner. Growing charges the cost difference plus 15%; shrinking refunds half.
- `hotelSet` also takes `rate` (room price, 50–250% of the style's going rate; higher rates lose bookings), `service` (`budget`, `standard`, `premium`: wages, occupancy, wear, amenity spend) and `refurbish: true` (restores `condition`, which wears nightly and cuts occupancy below 80%).
- New amenity add-ons (`restaurant`, `spa`, `conference`, `giftShop`, `kidsClub`) earn a share of the room rate per booked room and cost a daily running cost; their fit-out price scales with rooms (`addonCost`). Resort-district hotels charge a resort fee per booked room.
- Each night `hotelNight` books room sales, amenities, staff, utilities, building upkeep and amenity running costs into `hotel.night`, `hotel.profit`, `hotel.nights` (last 30) and the ledger keys `hotels`, `hotelAmenities`, `hotelStaff` and `hotelUpkeep`. `hotel.invested` tracks money put in for ROI and payback. Snapshots carry these fields.

### Thrill Park v53

Redeploy this service with the frontend so online parks run the same rules as solo play:
- New entity type `hotel` (`server/park/hotels.mjs`) in eight styles (`HOTELS`), placed with the `hotel` command (`kind`, `x`, `y`, `w`, `h`, `floors`) next to a footpath and customized with `hotelSet` (`primary`, `secondary`, `trim` colors as integers, `roof`, `addon` + `on`, `name`).
- Each hotel adds rooms × 0.5 to the guest cap, earns nightly room income (`p.month.hotels`) and pays daily upkeep (`p.month.hotelUpkeep`); its build cost counts toward park and company value.
- Some new guests check in from hotel doors instead of the park gate; they pay the entry fee on arrival, stay longer and carry more cash.
- Two or more hotels beside a pool or wave pool within 10 squares form a resort district (`p.resortHotels`), adding up to 100 rating.
- Snapshots carry `hotels` (occupancy, income, last night, district).
