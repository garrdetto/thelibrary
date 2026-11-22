/**
 * The AI field's iconic schemes as references for the AI paint designer. `ref` names the real car the
 * scheme recreates, for research only; `sponsor` is the parody sponsor the design paints instead of the
 * real one, and `driver` the parody name. The designer's output is stored per `scheme` id
 * (`/api/shorttrack-paint?field=1`) and replaces the hand-made scheme in `iconic-schemes.js` for that car.
 */
export type FieldRef = { scheme: string; number: string; driver: string; ref: string; sponsor: string; sub?: string }

export const FIELD_REFS: FieldRef[] = [
  { scheme: 'bumphardt3', number: '3', driver: 'Dale Bumphardt', ref: "Dale Earnhardt's black #3 GM Goodwrench Service Plus Chevrolet Monte Carlo (1996–1998)", sponsor: 'GOODWRECK', sub: 'SERVICE PLUS' },
  { scheme: 'rainbow24', number: '24', driver: 'Jeff Hair-don', ref: "Jeff Gordon's #24 DuPont 'Rainbow Warriors' Chevrolet Monte Carlo (1995–2000)", sponsor: 'DUPAINT' },
  { scheme: 'petty43', number: '43', driver: 'Richard Pretty', ref: "Richard Petty's #43 STP Pontiac in Petty blue and STP red (1980s)", sponsor: 'STOP' },
  { scheme: 'bud8', number: '8', driver: 'Dale Earnvotes Jr.', ref: "Dale Earnhardt Jr.'s red #8 Budweiser Chevrolet Monte Carlo (2000–2004)", sponsor: 'Mudweiser' },
  { scheme: 'upx88', number: '88', driver: 'Dale Deliverett', ref: "Dale Jarrett's brown and gold #88 UPS Ford Taurus (2001–2005)", sponsor: 'OOPS' },
  { scheme: 'lowez48', number: '48', driver: 'Jimmie Yawnson', ref: "Jimmie Johnson's blue and silver #48 Lowe's Chevrolet (2006–2008)", sponsor: "SLOWE'S" },
  { scheme: 'depo20', number: '20', driver: "Tony Stewin'", ref: "Tony Stewart's orange #20 Home Depot Pontiac Grand Prix / Chevrolet (1999–2005)", sponsor: 'THE HOME DEBT-O' },
  { scheme: 'draught2', number: '2', driver: 'Rusty Walrus', ref: "Rusty Wallace's black and gold #2 Miller Genuine Draft Ford Thunderbird (1990s)", sponsor: 'MULLET', sub: 'GENUINE DRAFT' },
  { scheme: 'valvo6', number: '6', driver: "Mark Marryin'", ref: "Mark Martin's #6 Valvoline Ford Thunderbird / Taurus (1990s)", sponsor: "VALVOLYIN'" },
  { scheme: 'bigbun94', number: '94', driver: 'Bill Smelliott', ref: "Bill Elliott's red and yellow #94 McDonald's Ford Thunderbird (1995–1997)", sponsor: "McDONUT'S" },
  { scheme: 'kelloggz5', number: '5', driver: 'Terry La-Brrr-nte', ref: "Terry Labonte's #5 Kellogg's Corn Flakes Chevrolet Monte Carlo (1996)", sponsor: "Jellogg's" },
  { scheme: 'coorz9', number: '9', driver: 'Awful Bill Elliyacht', ref: "Bill Elliott's red #9 Coors Ford Thunderbird (1985–1987)", sponsor: 'CHORES', sub: 'WATERED DOWN' },
  { scheme: 'fedez11', number: '11', driver: 'Denny Hamlost', ref: "Denny Hamlin's #11 FedEx Express Toyota Camry in purple, white and orange (2010s)", sponsor: 'Fed Up' },
  { scheme: 'dewolt17', number: '17', driver: 'Bratt Kenseth', ref: "Matt Kenseth's yellow and black #17 DeWalt Ford Taurus (2000–2003)", sponsor: 'DEFAULT' },
  { scheme: 'interstake18', number: '18', driver: 'Bobby Labattery', ref: "Bobby Labonte's green and black #18 Interstate Batteries Pontiac Grand Prix (2000)", sponsor: 'INTERSTATIC', sub: 'BATTERIES' },
  { scheme: 'havolube28', number: '28', driver: 'Davey Allisnot', ref: "Davey Allison's black #28 Texaco Havoline Ford Thunderbird (1990–1993)", sponsor: 'HAVOCLINE' },
  { scheme: 'woodbros21', number: '21', driver: 'David Pearsnip', ref: "David Pearson's red and white #21 Wood Brothers Purolator Mercury Cyclone (1970s)", sponsor: 'MOTORCRAFTY' },
  { scheme: 'aflaq99', number: '99', driver: 'Carl Backwards', ref: "Carl Edwards's white and blue #99 Aflac Ford Fusion (2008)", sponsor: 'AFLAP!' },
  { scheme: 'shellzoil22', number: '22', driver: 'Joey Loafano', ref: "Joey Logano's yellow and red #22 Shell-Pennzoil Ford Fusion (2018)", sponsor: 'SMELLZOIL' },
  { scheme: 'nappa15', number: '15', driver: 'Michael Waltripped', ref: "Michael Waltrip's blue and yellow #15 NAPA Auto Parts Chevrolet Monte Carlo (2001)", sponsor: 'NAPTIME', sub: 'AUTO PARTS' },
  { scheme: 'goodfix29', number: '29', driver: 'Kevin Harshvick', ref: "Kevin Harvick's white and black #29 GM Goodwrench Service Plus Chevrolet Monte Carlo (2001)", sponsor: 'GOODWRECK', sub: 'SERVICE PLUS' },
  { scheme: 'kodiak4', number: '4', driver: "Sterling Mumblin'", ref: "Sterling Marlin's yellow and red #4 Kodak Film Chevrolet Monte Carlo (1995)", sponsor: 'KODIAK', sub: 'BEAR FILM' },
  { scheme: 'goduddy10', number: '10', driver: 'Danica Pat-Wreck', ref: "Danica Patrick's bright green #10 GoDaddy Chevrolet SS (2013)", sponsor: 'GoDoody' },
]

export const fieldRef = (scheme: string) => FIELD_REFS.find(f => f.scheme === scheme) ?? null
