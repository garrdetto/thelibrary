export type TipArticle = {
  id: string
  category: 'Ball flight' | 'Driver' | 'Irons & wedges' | 'Practice' | 'GSPro'
  title: string
  summary: string
  body: string[]
  checklist?: string[]
  numbers?: { label: string; value: string }[]
}

export const tipArticles: TipArticle[] = [
  {
    id: 'ball-flight-laws',
    category: 'Ball flight',
    title: 'Face starts it, path curves it',
    summary: 'Why the start line follows the face and the curve follows face to path.',
    body: [
      'At impact the ball leaves mostly in the direction the face points: roughly 75% face and 25% path for an iron, closer to 85% face for a driver. So the start line (HLA) is your best clue to the face angle.',
      'The curve comes from the difference between face and path. A face open to the path tilts the spin axis toward a fade; a face closed to the path tilts it toward a draw. Each degree of face to path adds roughly two to three degrees of spin axis.',
      'A push slice therefore means the face was open to the target and more open to the path. Fix the face first, then the path.',
    ],
    checklist: ['Start line off target? Look at grip and face angle.', 'Curve too big? Look at face to path.', 'Both? Change one thing at a time.'],
    numbers: [{ label: 'Playable face to path', value: '−2° to +2°' }, { label: 'Spin axis per degree F2P', value: '≈ 2–3°' }],
  },
  {
    id: 'driver-window',
    category: 'Driver',
    title: 'Find your driver launch window',
    summary: 'The launch and spin that carry furthest depend on ball speed.',
    body: [
      'Faster players want less launch and less spin; slower players need more of both to keep the ball in the air. The goal is the most carry for the speed you already have.',
      'Launch comes from dynamic loft and attack angle. Spin comes mostly from spin loft (dynamic loft minus attack angle) and from where the ball meets the face: high strikes launch higher with less spin, low strikes do the opposite.',
      'Hitting up on the driver is the free lunch: more launch with less spin at the same speed.',
    ],
    numbers: [
      { label: 'Under 140 mph ball speed', value: '13.5–17° · 2400–3000 rpm' },
      { label: '140–160 mph', value: '12–16° · 2100–2800 rpm' },
      { label: '160 mph and up', value: '10.5–14.5° · 1800–2600 rpm' },
    ],
  },
  {
    id: 'attack-angle',
    category: 'Driver',
    title: 'Attack angle: up with the driver, down with irons',
    summary: 'A positive attack angle off the tee and a negative one from the turf.',
    body: [
      'With the ball teed forward, the club should reach the bottom of its arc before impact and be travelling up. Tour averages are slightly down with the driver, but long hitters are up 2–5°, and it is worth 10+ yards for most players.',
      'With irons the low point should be in front of the ball. Ball first, then turf, at 3–6° down. Hitting up on an iron means the low point is behind the ball: thin and fat shots and wild spin follow.',
    ],
    checklist: ['Driver: ball off the lead heel, spine tilted away from target.', 'Irons: weight 55–60% lead side at impact, hands ahead of the ball.'],
  },
  {
    id: 'spin-loft',
    category: 'Irons & wedges',
    title: 'Spin loft and landing angle',
    summary: 'How dynamic loft and attack angle decide spin, height and stopping power.',
    body: [
      'Spin loft is the angle between where the face points (dynamic loft) and where the club is travelling (attack angle). More spin loft, more spin. A steep attack with a lot of shaft lean can still spin well; scooping adds launch but loses compression.',
      'For approach shots the landing angle matters more than spin alone. Above about 45° the ball stops quickly; below 40° it releases. Mid irons that land flat usually need either more speed or more launch.',
      'A simple check: iron spin around 1,000 rpm per iron number (7,000 for a 7 iron) is a healthy middle.',
    ],
    numbers: [{ label: '7 iron spin', value: '≈ 6,000–7,500 rpm' }, { label: 'Approach landing angle', value: '45–50°+' }],
  },
  {
    id: 'strike',
    category: 'Practice',
    title: 'Strike location and smash factor',
    summary: 'Centred contact is the cheapest distance you will ever find.',
    body: [
      'Smash factor is ball speed divided by club speed. It tells you how well the energy got into the ball. A driver struck in the centre gets close to 1.50; a 7 iron about 1.33; wedges 1.15–1.25.',
      'Heel and toe strikes twist the head, which adds gear effect: toe strikes tend to draw, heel strikes tend to fade, even with a square face.',
      'Use foot spray or impact tape for a session and match each mark to the numbers on the shot.',
    ],
    numbers: [{ label: 'Driver', value: '1.44–1.50' }, { label: '7 iron', value: '1.30–1.36' }, { label: 'Pitching wedge', value: '1.20–1.27' }],
  },
  {
    id: 'dispersion',
    category: 'Ball flight',
    title: 'Read your dispersion, then aim for it',
    summary: 'Use the pattern, not the best shot, to choose targets.',
    body: [
      'One standard deviation of offline distance covers about two thirds of your shots. Twice that covers nearly all of them. That pattern, not your best swing, is what you take to the course.',
      'If the middle of the pattern sits left or right of target, aim the middle at the target. Tightening the pattern is a long project; moving your aim is free.',
      'Good players are around 5% of carry offline per standard deviation. Over 8% is costing shots.',
    ],
  },
  {
    id: 'gapping',
    category: 'Practice',
    title: 'Build a gapping chart',
    summary: 'Know your carry with every club and keep 10–15 yard steps.',
    body: [
      'Hit at least ten good shots with each club, drop the worst two, and use the average carry. Total distance changes with the turf; carry does not.',
      'Even steps of 10–15 yards through the irons, and 15–20 at the top of the bag, mean there is always a full swing for the number. Overlaps waste a slot in the bag; big gaps force awkward half swings.',
      'Wedges are where scoring happens: learn a full, three-quarter and half swing with each one.',
    ],
    checklist: ['10+ shots per club', 'Use carry, not total', 'Repeat every few months'],
  },
  {
    id: 'practice-plan',
    category: 'Practice',
    title: 'A 45-minute simulator practice plan',
    summary: 'Block practice to groove, random practice to test.',
    body: [
      'Warm up with 10 wedge shots to a 50-yard target, then 10 half swings with a 7 iron.',
      'Block practice (15 minutes): one club, one goal from the Tips tab, the same target every time. Watch the one number you are changing.',
      'Random practice (15 minutes): play a hole in your head. Driver, then the club for the number left, changing targets every shot. Score yourself on fairways and greens hit.',
      'Finish with 10 shots to a number between your clubs, using a shorter swing.',
    ],
  },
  {
    id: 'gspro-range',
    category: 'GSPro',
    title: 'Getting good data from GSPro',
    summary: 'Small setup details that keep the numbers honest.',
    body: [
      'Pick the club in GSPro before each shot. The bridge records the club GSPro has selected, so a forgotten switch files a 7 iron under the driver.',
      'Turn off mulligans and the putting auto-gimme on the range so every swing counts. Use the Exclude button here for shanks or mis-reads rather than deleting them.',
      'Compare carry from the launch monitor (when it sends it) with the estimate shown here. A big gap usually means altitude or temperature settings in GSPro differ from sea level.',
    ],
  },
  {
    id: 'speed-training',
    category: 'Driver',
    title: 'Adding speed safely',
    summary: 'Overspeed sets, rest and measuring the right number.',
    body: [
      'Speed comes from swinging faster, not harder. Short sets of maximum-effort swings (5 swings, then rest) three times a week build speed over 6–8 weeks.',
      'Track ball speed rather than club speed: it includes the strike. A new club speed record with a worse smash factor does not help.',
      'Stop the set when speed drops for two swings in a row. Tired swings teach bad patterns.',
    ],
  },
]

export const tipCategories = [...new Set(tipArticles.map(article => article.category))]
