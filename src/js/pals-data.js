'use strict';
/*
 * Pal roster: 50 evolution lines across 9 types, plus weekly bosses.
 * art fields use stage tokens (see pal-art.js): "dot|sharp@3".
 * Rarity: C Common · R Rare · E Epic · L Legendary.
 */

(function (root) {
  const TYPES = {
    fire: { name: 'Fire', color: '#E8604C', strong: ['grass', 'fairy'] },
    water: { name: 'Water', color: '#3C82C8', strong: ['fire', 'ground'] },
    grass: { name: 'Grass', color: '#58B368', strong: ['water', 'ground'] },
    ground: { name: 'Ground', color: '#C9925A', strong: ['fire', 'psychic'] },
    flying: { name: 'Flying', color: '#6FB3E8', strong: ['grass', 'water'] },
    dark: { name: 'Dark', color: '#5B4F7A', strong: ['psychic', 'ghost'] },
    fairy: { name: 'Fairy', color: '#E879A8', strong: ['dark', 'flying'] },
    ghost: { name: 'Ghost', color: '#8E7BC8', strong: ['psychic', 'fairy'] },
    psychic: { name: 'Psychic', color: '#C25FB0', strong: ['dark', 'flying'] },
  };
  // Psychic beating Dark would make the two cancel out; keep it one-way.
  TYPES.psychic.strong = ['water', 'flying'];

  const RARITY = {
    C: { name: 'Common', color: '#8A9AA8', weight: 60, exp: 1, mult: 1 },
    R: { name: 'Rare', color: '#3C82C8', weight: 27, exp: 1.15, mult: 1.5 },
    E: { name: 'Epic', color: '#8E6BD1', weight: 10, exp: 1.3, mult: 2 },
    L: { name: 'Legendary', color: '#E8A93C', weight: 3, exp: 1.5, mult: 3 },
  };

  /* Ability effects. v = value at full evolution for a Common pal. */
  const FX = {
    xpPct: { v: 5, fmt: (x) => `+${x}% XP` },
    goldPct: { v: 6, fmt: (x) => `+${x}% gold` },
    palExpPct: { v: 8, fmt: (x) => `+${x}% pal EXP for the whole team` },
    bossPct: { v: 10, fmt: (x) => `+${x}% boss damage` },
    focusPct: { v: 10, fmt: (x) => `+${x}% focus-round rewards` },
    dropPct: { v: 20, fmt: (x) => `+${x}% item find` },
    dmgRed: { v: 6, fmt: (x) => `−${x}% HP damage taken` },
    healDay: { v: 2, fmt: (x) => `+${x} HP every new day` },
    dailyPct: { v: 6, fmt: (x) => `+${x}% rewards from dailies` },
    reminderPct: { v: 10, fmt: (x) => `+${x}% rewards from reminders` },
    habitPct: { v: 10, fmt: (x) => `+${x}% rewards from habits` },
    earlyPct: { v: 12, fmt: (x) => `+${x}% rewards before 10 AM` },
    nightPct: { v: 12, fmt: (x) => `+${x}% rewards after 8 PM` },
    critChance: { v: 4, fmt: (x) => `${x}% chance a task pays double gold` },
    shieldSave: { v: 12, fmt: (x) => `${x}% chance a Streak Shield isn't used up` },
    gachaDiscount: { v: 4, fmt: (x) => `−${x}% Capsule Machine cost` },
    streakGuard: { v: 6, fmt: (x) => `${x}% chance to keep a missed daily's streak` },
  };

  const L = (id, type, r, names, ab, fx, lore, art) => ({ id, type, r, names, ab, fx, lore, art });

  const LINES = [
    /* ------------------------------------------------------------ FIRE */
    L('coalby', 'fire', 'C', ['Coalby', 'Cindrock', 'Blazboulder', 'Magmaw'], 'Stoke the Fire', 'bossPct',
      'A warm pebble that glows brighter every time you finish something hard.',
      { body: 'round|block@3', m: '#5A5F6E', a: '#E8604C', a2: '#F2C14E', eye: '#F2C14E', crest: 'flame|flame+horns@4', pat: '|cracks@3', eyes: 'dot|sharp@4', arms: '|nubs@3' }),
    L('emberkit', 'fire', 'C', ['Emberkit', 'Flarecat', 'Blazepaw', 'Infernyx'], 'Kindle Dash', 'dailyPct',
      'Its tail flickers like a candle. Chases the morning sun around the house.',
      { body: 'egg', m: '#F29A4E', b: '#FFE3B8', a: '#E8604C', a2: '#F2C14E', ears: 'point', tail: 'flame', pat: 'belly|belly+stripes@3', mouth: 'cat', eyes: 'dot|sharp@4', crest: '|flame@4' }),
    L('wickit', 'fire', 'E', ['Wickit', 'Candlet', 'Lanternel', 'Chandelux', 'Pyrespire'], 'Night Light', 'nightPct',
      'A shy candle spirit. Late-night study sessions make its wick burn tall.',
      { body: 'tall|block@4', m: '#FFF1D6', a: '#F29A4E', a2: '#FFE07A', crest: 'flame|flame+crown@5', arms: '|nubs@3', pat: '|chest@4', eyes: 'dot|big@3', aura: '@5', wings: '|flame@5' }),
    L('sizzlet', 'fire', 'R', ['Sizzlet', 'Scorchick', 'Pyrehawk', 'Solflare'], 'Rising Heat', 'xpPct',
      'Hatches from an ember. Its first flight leaves a little trail of sparks.',
      { body: 'round|egg@3', m: '#E8604C', b: '#FFD9A0', a: '#F2C14E', a2: '#FFF1A8', mouth: 'beak', wings: 'tiny|feather@2|flame@4', tail: '|flame@2', crest: '|tuft@2|flame@3', pat: 'belly', feet: 'stubby:G' }),
    L('kilnling', 'fire', 'R', ['Kilnling', 'Kilnback', 'Volcashell', 'Caldertort', 'Magmaruin'], 'Hearth Shell', 'dmgRed',
      'A turtle with an oven for a shell. Slow, steady, always warm.',
      { body: 'wide', m: '#7FA36A', a: '#8A6A54', a2: '#E8604C', pat: 'shell|shell+cracks@4', crest: '|volcano@3', tail: 'spike', eyes: 'dot|sleepy@2|dot@4', ears: '', aura: '@5' }),
    L('solkit', 'fire', 'L', ['Solkit', 'Solcub', 'Solmane', 'Solvane', 'Solvanir'], 'Sunblessed', 'xpPct',
      'Said to carry a sliver of the noon sun. Everything it walks past grows a little.',
      { body: 'egg|tall@4', m: '#F2C14E', b: '#FFF1C4', a: '#E8604C', a2: '#FFE07A', ears: 'round', crest: '|mane@2|mane+crown@5', tail: 'long:flame', pat: 'belly', eyes: 'dot|sharp@4', aura: '@4', sz: 1.06 }),

    /* ----------------------------------------------------------- WATER */
    L('drizzle', 'water', 'C', ['Drizzle', 'Rainpuff', 'Nimbloom', 'Monsoonix'], 'Rainy Day', 'focusPct',
      'A cloud puff that rains a little when it is concentrating very hard.',
      { body: 'cloud', m: '#DCEFFB', a: '#3C82C8', a2: '#9FD4F5', tail: '|rain@2', eyes: 'dot|big@3', crest: '|drop@3|horns@4', float: '@1' }),
    L('bubbit', 'water', 'C', ['Bubbit', 'Bubblefin', 'Tidefin', 'Mariwave'], 'Go with the Flow', 'habitPct',
      'Blows a bubble for every good habit. Pops them when you skip one.',
      { body: 'egg|drop@3', m: '#5DA9E9', b: '#D6EEFF', a: '#2A6FB0', a2: '#9FE0F0', ears: 'fin', tail: 'fish', pat: 'belly', float: '@1', mouth: 'open|smile@3', crest: '|crystal@4' }),
    L('shellbit', 'water', 'C', ['Shellbit', 'Clampet', 'Pearlguard', 'Nautilord'], 'Hard Shell', 'dmgRed',
      'Scuttles sideways when nervous. Collects shiny pebbles for its room.',
      { body: 'wide', m: '#E86A5C', b: '#FFD3C4', a: '#B8432F', a2: '#FFE0D0', crest: 'eyestalks|eyestalks+spikes@3', arms: 'claws', pat: 'belly', eyes: 'dot', mouth: 'smile' }),
    L('splotter', 'water', 'R', ['Splotter', 'Otterpaw', 'Rapidotter', 'Torrentide'], 'Playful Current', 'palExpPct',
      'Loves company. The whole team learns faster when it is around.',
      { body: 'egg|tall@3', m: '#4A9FB5', b: '#E6F6F2', a: '#2F7A8C', a2: '#9FE0F0', ears: 'round', tail: 'fluffy', pat: 'belly', mouth: 'cat', arms: '|nubs@3', crest: '|drop@4' }),
    L('lotlie', 'water', 'R', ['Lotlie', 'Axolittle', 'Gillmore', 'Axolord', 'Abyssalotl'], 'Regenerate', 'healDay',
      'Always smiling. Recovers from anything after a good night of sleep.',
      { body: 'wide|egg@3|tall@4', m: '#F4A7C0', b: '#FFE4EC', a: '#D85A8C', a2: '#FFC2D6', ears: 'gills', tail: '|fish@2', pat: 'belly', mouth: 'smile', arms: '|nubs@4', crest: '|crystal@5', aura: '@5' }),
    L('mareling', 'water', 'L', ['Mareling', 'Marelune', 'Tidewyrm', 'Leviacrest', 'Tidecrown'], 'Undertow', 'bossPct',
      'Sleeps at the bottom of the sea and wakes when a great challenge appears.',
      { body: 'drop|tall@3', m: '#2A5F96', b: '#9FE0F0', a: '#52D3B3', a2: '#C8FFF2', ears: 'fin', tail: 'fish', crest: '|horns@2|horns+crown@5', wings: '|fin@3', pat: 'belly', eyes: 'dot|sharp@3', aura: '@4', sz: 1.06 }),

    /* ----------------------------------------------------------- GRASS */
    L('sprigg', 'grass', 'C', ['Sprigg', 'Leafling', 'Grovekin', 'Elderoot'], 'Morning Dew', 'earlyPct',
      'A sprout critter that wakes with the sun. Happiest on productive mornings.',
      { body: 'round|egg@3', m: '#FFF6DA', a: '#58B368', a2: '#9AD67E', crest: 'sprout|flower:K@2|bush@3|bush:fruit@4', arms: '|nubs@3', pat: '', mouth: 'smile' }),
    L('mossbun', 'grass', 'C', ['Mossbun', 'Clovhop', 'Thistlehare', 'Meadowhorn'], 'Lucky Clover', 'critChance',
      'Its ears smell of clover. Occasionally finds coins in the grass.',
      { body: 'egg', m: '#8BC47A', b: '#EFF7E0', a: '#4E8F48', a2: '#F48FB1', ears: 'long', tail: 'fluffy', pat: 'belly', crest: '|flower@3|antlers:leaf@4', mouth: 'cat' }),
    L('sporb', 'grass', 'C', ['Sporb', 'Shroomlet', 'Capshroom', 'Myceloom', 'Fungarch'], 'Spore Cloud', 'dropPct',
      'Leaves a puff of spores wherever it naps. Things tend to turn up nearby.',
      { body: 'round|tall@3', m: '#F0E2C8', a: '#D8504A', a2: '#F28B7A', crest: 'cap', arms: '|nubs@3', eyes: 'dot|big@4', aura: '@5' }),
    L('tendrill', 'grass', 'R', ['Tendrill', 'Vinewhip', 'Briarcoil', 'Thornlash'], 'Entangle', 'bossPct',
      'Wraps problems up in vines until they stop wriggling.',
      { body: 'drop|egg@3', m: '#3A8C4E', b: '#B7E3A0', a: '#7CC66A', a2: '#E8604C', ears: 'leaf', tail: 'leaf', pat: 'belly', crest: '|flower@3|spikes@4', eyes: 'dot|sharp@3' }),
    L('pricklet', 'grass', 'R', ['Pricklet', 'Cactoo', 'Spinedune', 'Saguardian'], 'Thrifty Thorn', 'goldPct',
      'Needs very little to be happy and saves the rest for later.',
      { body: 'tall|block@3', m: '#58B368', a: '#2F7A3E', a2: '#F48FB1', pat: 'spots', crest: '|flower@2', arms: '|nubs@3', eyes: 'dot|sleepy@3|dot@4', cheeks: true }),
    L('nutling', 'grass', 'E', ['Nutling', 'Acornet', 'Oakshade', 'Grovewarden', 'Eldergrove'], 'Deep Roots', 'streakGuard',
      'Grows a ring for every streak you keep. Very hard to knock over.',
      { body: 'round|egg@3|tall@4', m: '#B07A4E', b: '#F0D8B0', a: '#58B368', a2: '#9AD67E', crest: 'tuft|sprout@2|antlers:leaf@3|bush@4|bush+crown@5', pat: 'belly', arms: '|nubs@3', aura: '@5' }),

    /* ---------------------------------------------------------- GROUND */
    L('pebbit', 'ground', 'C', ['Pebbit', 'Rocklet', 'Boulderon', 'Monolith'], 'Steady', 'dmgRed',
      'Sits very still. Has never once been in a hurry.',
      { body: 'round|block@2', m: '#A39A8B', a: '#7A7064', a2: '#C8F0FF', pat: 'spots', crest: '|crystal@3', eyes: 'dot|sleepy@3', arms: '|nubs@4' }),
    L('mudmole', 'ground', 'C', ['Mudmole', 'Tunnelpaw', 'Drillmole', 'Quakemole'], 'Dig Deep', 'dropPct',
      'Tunnels under the garden and pops up with something useful.',
      { body: 'egg', m: '#7A5A44', b: '#E6C9A8', a: '#F2C14E', a2: '#FFF1A8', mouth: 'snout', arms: '|claws@2', crest: '|horn@3', pat: 'belly', eyes: 'sleepy|dot@3' }),
    L('scarabit', 'ground', 'C', ['Scarabit', 'Dunebeetle', 'Sandscarab', 'Pharabeetle'], 'Treasure Sense', 'goldPct',
      'Rolls a little ball of gold dust everywhere it goes.',
      { body: 'wide', m: '#D9A86C', a: '#3C82C8', a2: '#7FC8F0', crest: 'antenna|horn+antenna@2|horn+crown@4', pat: 'spots', eyes: 'dot' }),
    L('rolldil', 'ground', 'R', ['Rolldil', 'Armadune', 'Plateroll', 'Bastionback', 'Terradillo'], 'Curl Up', 'shieldSave',
      'Curls into a ball when things go wrong, then rolls on like nothing happened.',
      { body: 'wide|egg@4', m: '#C99A6E', b: '#F2DDC2', a: '#8A6A4E', a2: '#F2C14E', pat: 'bands', ears: 'round', tail: 'spike', crest: '|spikes@3', aura: '@5' }),
    L('claypip', 'ground', 'E', ['Claypip', 'Kilnkin', 'Terragolem', 'Colossand', 'Titanclay'], 'Earthshaker', 'bossPct',
      'Shaped from riverbank clay. Each evolution it adds another crystal to its crown.',
      { body: 'round|block@2', m: '#C9704E', a: '#58D0F0', a2: '#C8F6FF', eye: '#58D0F0', eyes: 'dot|glow@3', arms: '|nubs@2', crest: '|crystal@3|crystal+crown@5', pat: '|cracks@4', aura: '@5', sz: 1.04 }),

    /* ---------------------------------------------------------- FLYING */
    L('peeplet', 'flying', 'C', ['Peeplet', 'Finchly', 'Swiftail', 'Galewing'], 'Early Bird', 'earlyPct',
      'Sings at sunrise. Very proud of you for getting up.',
      { body: 'round|egg@3', m: '#74B9F0', b: '#FFF6DA', a: '#2A6FB0', a2: '#F2C14E', mouth: 'beak', wings: 'tiny|feather@2', tail: '|fish@2', crest: '|tuft@3', pat: 'belly', feet: 'stubby:G' }),
    L('hootlet', 'flying', 'C', ['Hootlet', 'Owlbert', 'Hoothaven', 'Sageowl'], 'Night Watch', 'nightPct',
      'Stays up late with you. Hoots softly when it is time for bed.',
      { body: 'egg', m: '#A68B6A', b: '#F0E2C8', a: '#6E5A44', a2: '#F2C14E', ears: 'tuft', eyes: 'big', mouth: 'beak', wings: '|feather@2', pat: 'belly|belly+chest@4', feet: 'stubby:G' }),
    L('zephlet', 'flying', 'R', ['Zephlet', 'Breezekite', 'Galedancer', 'Skyribbon'], 'Tailwind', 'xpPct',
      'A kite that came to life on a windy day. Never stops moving.',
      { body: 'diamond', m: '#F2C14E', a: '#E879A8', a2: '#FFF1A8', tail: 'ribbon', float: '@1', wings: '|fairy@3', crest: '|antenna@2', eyes: 'dot|happy@3' }),
    L('fluffle', 'flying', 'C', ['Fluffle', 'Woolcloud', 'Nimbram', 'Stratoram'], 'Soft Landing', 'healDay',
      'A sheep made of cloud. Falling asleep on it fixes most bad days.',
      { body: 'cloud', m: '#FBFBFB', a: '#6E7A8E', a2: '#C8D2E0', crest: '|horns@3', ears: '|round@2', float: '@1', eyes: 'sleepy|dot@2|happy@4' }),
    L('talonet', 'flying', 'R', ['Talonet', 'Hawklet', 'Skyhawk', 'Stormtalon', 'Aeroking'], 'Keen Eye', 'critChance',
      'Spots a bargain from a mile away. Rarely misses.',
      { body: 'egg|tall@4', m: '#8A5A3A', b: '#FFFDF4', a: '#5A3A24', a2: '#F2C14E', mouth: 'beak', wings: 'tiny|feather@2', crest: '|tuft@2|tuft+crown@5', tail: '|fish@3', pat: 'belly', eyes: 'dot|sharp@3', feet: 'stubby:G', aura: '@5' }),
    L('zipling', 'flying', 'E', ['Zipling', 'Dartwing', 'Skimmerling', 'Prismdart'], 'Swift', 'focusPct',
      'Hovers perfectly still for exactly 25 minutes, then zips away.',
      { body: 'drop', m: '#52D3B3', a: '#2FA58A', a2: '#C8FFF2', wings: 'insect', eyes: 'big', float: '@1', crest: '|antenna@2', pat: '|stripes@3', aura: '@4' }),

    /* ------------------------------------------------------------ DARK */
    L('shadepup', 'dark', 'C', ['Shadepup', 'Gloomhound', 'Duskfang', 'Nightfang'], 'Pack Hunt', 'bossPct',
      'Loyal to a fault. Growls at deadlines.',
      { body: 'egg|tall@4', m: '#3B3B52', b: '#6C6C88', a: '#E8604C', a2: '#FF9A7A', eye: '#E8604C', ears: 'point', tail: 'long', eyes: 'dot|sharp@2', mouth: 'smile|fang@3', pat: 'belly', crest: '|spikes@4' }),
    L('batlet', 'dark', 'C', ['Batlet', 'Duskwing', 'Nyctobat', 'Vampyrex'], 'Night Owl', 'nightPct',
      'Hangs upside down from your curtain rail. Most awake after dark.',
      { body: 'round', m: '#6A4C8A', b: '#B79FD6', a: '#3E2A5A', a2: '#E879A8', ears: 'point', wings: 'bat', mouth: 'fang', float: '@1', eyes: 'dot|sharp@4', pat: 'belly' }),
    L('crowlet', 'dark', 'C', ['Crowlet', 'Corvex', 'Shadowrook', 'Omencrest'], 'Shiny Hoard', 'goldPct',
      'Collects shiny things. Some of them turn out to be gold.',
      { body: 'round|egg@3', m: '#2E3245', b: '#4A5070', a: '#1A1C28', a2: '#8E6BD1', mouth: 'beak', wings: 'tiny|feather@2', crest: '|tuft@3|tuft+crown@4', eyes: 'dot|sharp@3', tail: '|fish@2', feet: 'stubby:G', eye: '#F2C14E' }),
    L('pilfer', 'dark', 'R', ['Pilfer', 'Banditkit', 'Masquerac', 'Phantail'], 'Pickpocket', 'dropPct',
      'Wears a mask and borrows things. Always gives them back, mostly.',
      { body: 'egg', m: '#8A8FA3', b: '#E6E8EF', a: '#3B3B52', a2: '#C9CCD6', ears: 'round', tail: 'fluffy', pat: 'mask+belly', mouth: 'cat', eyes: 'dot', eye: '#F2F2F2' }),
    L('umbrakit', 'dark', 'E', ['Umbrakit', 'Shadowcat', 'Eclipsyx', 'Umbralynx', 'Nightregent'], 'Eclipse', 'xpPct',
      'Its eyes shine like two small moons. Rules the night quietly.',
      { body: 'egg|tall@4', m: '#2B2340', b: '#4A3F66', a: '#F2C14E', a2: '#FFF1A8', eye: '#F2C14E', ears: 'point', tail: 'long', eyes: 'glow|sharp@3', mouth: 'cat', crest: '|moon@3|moon+crown@5', pat: 'belly', aura: '@4' }),

    /* ----------------------------------------------------------- FAIRY */
    L('pixling', 'fairy', 'C', ['Pixling', 'Twinklet', 'Glimmerix', 'Starsprite'], 'Pixie Dust', 'palExpPct',
      'Sprinkles glitter on the whole party. Everyone feels a bit more capable.',
      { body: 'drop', m: '#F8C8DC', a: '#E879A8', a2: '#FFF1A8', wings: 'fairy', crest: 'antenna|antenna+halo@4', float: '@1', eyes: 'big', pat: '|stars@3' }),
    L('fluffin', 'fairy', 'C', ['Fluffin', 'Cottonbun', 'Cloudmallow', 'Dreamfluff'], 'Comfort', 'healDay',
      'Soft as a marshmallow. Hugs fix most of your HP problems.',
      { body: 'round|egg@3', m: '#FCE4EC', a: '#A68BE8', a2: '#FFFFFF', ears: 'long', tail: '|fluffy@2', crest: '|flower@3', eyes: 'happy|dot@2|happy@4', pat: '' }),
    L('bellbud', 'fairy', 'C', ['Bellbud', 'Chimelet', 'Belltwirl', 'Carillon', 'Grandchime'], 'Gentle Chime', 'reminderPct',
      'Rings softly a few minutes before anything important.',
      { body: 'bell', m: '#B8A2F0', a: '#F2C14E', a2: '#FFF1A8', crest: 'sprout|flower@2|flower+halo@4|crown@5', arms: '|nubs@3', eyes: 'dot|happy@3' }),
    L('shimmerfoal', 'fairy', 'R', ['Shimmerfoal', 'Starfoal', 'Prismane', 'Auralicorn', 'Celestimare'], 'Wish Upon', 'gachaDiscount',
      'Its horn grants small wishes. The Capsule Machine likes it.',
      { body: 'egg|tall@4', m: '#FFFDF4', a: '#E879A8', a2: '#F2C14E', ears: 'point', crest: '|horn@2', tail: 'fluffy', pat: '|stars@4', eyes: 'big', aura: '@5' }),
    L('lumoth', 'fairy', 'E', ['Lumoth', 'Lanternmoth', 'Glowmothra', 'Aurorawing'], 'Moonlight', 'focusPct',
      'Drawn to desk lamps. Focus sessions make its wings glow.',
      { body: 'egg', m: '#FFF1A8', b: '#FFFFFF', a: '#52D3B3', a2: '#C8FFF2', wings: 'fairy', crest: 'antenna', float: '@2', pat: 'belly', eyes: 'big', aura: '@4' }),

    /* ----------------------------------------------------------- GHOST */
    L('boolet', 'ghost', 'C', ['Boolet', 'Spookle', 'Phantomb', 'Wraithmoor'], 'Haunt', 'bossPct',
      'Says boo, then apologises. Bosses find it very distracting.',
      { body: 'ghost', m: '#E8ECF5', a: '#8E7BC8', a2: '#C9CCD6', mouth: 'open', eyes: 'dot|sharp@4', crest: '|halo@3|horns@4' }),
    L('wispette', 'ghost', 'C', ['Wispette', 'Lanternwisp', 'Ghastlight', 'Soulbeacon'], 'Guiding Light', 'reminderPct',
      'Floats ahead of you and lights the way to whatever you forgot.',
      { body: 'drop|ghost@3', m: '#9ED8EC', a: '#3C82C8', a2: '#C8F6FF', crest: 'flame', float: '@1', eyes: 'glow|dot@3', eye: '#23343B' }),
    L('purrgeist', 'ghost', 'C', ['Purrgeist', 'Ghostabby', 'Haunticat', 'Phantomeow'], 'Nine Lives', 'streakGuard',
      'A cat that refuses to give up. Your streaks inherit some of its lives.',
      { body: 'ghost', m: '#B9B3E8', a: '#6A5AA8', a2: '#E6E2FF', ears: 'point', tail: 'long', mouth: 'cat', eyes: 'dot|sharp@4', crest: '|halo@3' }),
    L('gourdie', 'ghost', 'R', ['Gourdie', 'Jackolet', 'Pumpkhaunt', 'Gourdgeist', 'Hallowking'], 'Harvest', 'dailyPct',
      'A pumpkin that came to life one autumn. Grows plumper on routine.',
      { body: 'wide|round@4', m: '#F29A4E', a: '#58B368', a2: '#FFE07A', eye: '#FFE07A', crest: 'stem|stem+crown@5', pat: 'bands', eyes: 'glow|sharp@2', mouth: 'smile|grin@2', arms: '|nubs@4', aura: '@5' }),
    L('wraithling', 'ghost', 'E', ['Wraithling', 'Shroudlet', 'Cloakwraith', 'Duskreaper', 'Soulwarden'], 'Soul Harvest', 'palExpPct',
      'Wears a cloak older than the house. Teaches the other pals old secrets.',
      { body: 'ghost', m: '#4A3A5A', a: '#2E2440', a2: '#7A6890', eye: '#52D3B3', eyes: 'glow', crest: '|hood@2|hood+horns@4|hood+horns+crown@5', aura: '@4', sz: 1.04 }),

    /* --------------------------------------------------------- PSYCHIC */
    L('orblet', 'psychic', 'C', ['Orblet', 'Visionorb', 'Seerorb', 'Omnisight'], 'Insight', 'xpPct',
      'One big curious eye. Notices everything you learn.',
      { body: 'round', m: '#A68BE8', a: '#6A4CA8', a2: '#F2C14E', eyes: 'cyclops', crest: '|antenna@2|antenna+halo@4', float: '@1', wings: '|tiny@3|fairy@4' }),
    L('spirikit', 'psychic', 'C', ['Spirikit', 'Mystifox', 'Seerfox', 'Kyuubrine'], 'Foresight', 'dailyPct',
      'Grows another tail every time it sees the future. You will finish today.',
      { body: 'egg', m: '#E9A8D8', b: '#FFF0FA', a: '#8E6BD1', a2: '#FFF1A8', ears: 'point', tail: 'fluffy|fluffy:2@2|fluffy:3@3|fluffy:5@4', crest: 'gem', pat: 'belly', mouth: 'cat' }),
    L('jellet', 'psychic', 'C', ['Jellet', 'Psyjelly', 'Mindmedusa', 'Cerebrella'], 'Calm Mind', 'focusPct',
      'Drifts slowly and thinks deeply. Very good at long focus sessions.',
      { body: 'slime', m: '#D7B8F0', a: '#A068D0', a2: '#F8E8FF', tail: 'tentacles', float: '@1', eyes: 'sleepy|dot@2|big@4', crest: '|gem@3', pat: '|spots@3' }),
    L('drowzil', 'psychic', 'R', ['Drowzil', 'Dozekoala', 'Dreamkoala', 'Somnarch'], 'Lucid Dream', 'palExpPct',
      'Always half asleep, yet somehow the wisest pal in the party.',
      { body: 'round|egg@3', m: '#A9A4C8', b: '#E6E2F5', a: '#6A5AA8', a2: '#F2C14E', ears: 'round', eyes: 'sleepy|sleepy|dot@4', mouth: 'snout', pat: 'belly', crest: '|gem@3|gem+halo@4', arms: '|nubs@2' }),
    L('fawnet', 'psychic', 'E', ['Fawnet', 'Crystalfawn', 'Prismstag', 'Astralelk', 'Aurorastag'], 'Clarity', 'critChance',
      'Its crystal antlers hum when a lucky moment is near.',
      { body: 'egg|tall@4', m: '#C9E4F7', b: '#FFFFFF', a: '#A68BE8', a2: '#E6DCFF', ears: 'point', crest: '|crystal@2|antlers@3|antlers+crystal@4|antlers+crystal+halo@5', pat: 'belly|belly+spots@2', tail: '|fluffy@3', aura: '@5' }),
    L('astrelle', 'psychic', 'L', ['Astrelle', 'Astrion', 'Cosmorb', 'Astraeon', 'Astrael'], 'Cosmic Favor', 'goldPct',
      'Fell from a meteor shower. Fortune follows it like a comet tail.',
      { body: 'diamond|drop@3', m: '#2A2F6E', a: '#F2C14E', a2: '#FFF1A8', eye: '#FFF1A8', eyes: 'glow|big@3', pat: 'stars', float: '@1', wings: '|tiny@2|cosmic@3', crest: '|halo@3|halo+crown@5', aura: '@4', sz: 1.06 }),
  ];

  /* Weekly bosses. Bosses with `art` are drawn by the generator; the rest use hand-made sprites. */
  const BOSSES = [
    { id: 'dustking', name: 'Dust Bunny King', type: 'flying', taunt: 'Your shelves belong to ME now.' },
    { id: 'snooze', name: 'Snooze Slime', type: 'psychic', taunt: 'Just five more minutes… forever.' },
    { id: 'clutter', name: 'Clutter Golem', type: 'ground', taunt: 'I am built from everything you put off.' },
    { id: 'wisp', name: 'Deadline Wisp', type: 'ghost', taunt: 'Tick… tock… tick… tock.' },
    { id: 'burnout', name: 'Burnout Blaze', type: 'fire', taunt: 'Push harder. Rest is for the weak. (It isn\'t.)', art: { body: 'drop', m: '#C8402E', a: '#F2C14E', a2: '#FFF1A8', crest: 'flame', eyes: 'angry', mouth: 'grin', ears: 'flame', float: '@1', aura: '@1' } },
    { id: 'overheat', name: 'Overheat Ogre', type: 'fire', taunt: 'Say yes to EVERYTHING.', art: { body: 'block', m: '#B85A3A', b: '#E8A070', a: '#F2C14E', a2: '#FFE07A', crest: 'horns', eyes: 'angry', mouth: 'fang', arms: 'nubs', pat: 'belly+cracks' } },
    { id: 'inbox', name: 'Inbox Kraken', type: 'water', taunt: '9,999 unread. Add one more?', art: { body: 'slime', m: '#3A6EA5', a: '#9FD4F5', a2: '#E6F4FF', tail: 'tentacles', eyes: 'angry', mouth: 'grin', float: '@1', pat: 'spots' } },
    { id: 'mildew', name: 'Mildew Mire', type: 'water', taunt: 'When did you last wipe the sink?', art: { body: 'slime', m: '#5A8A7A', a: '#2F5A4E', a2: '#B8E0C8', eyes: 'angry', mouth: 'open', pat: 'spots', crest: 'drop' } },
    { id: 'overgrowth', name: 'Overgrowth Ent', type: 'grass', taunt: 'The weeds have unionised.', art: { body: 'tall', m: '#6E5A44', a: '#3A8C4E', a2: '#7CC66A', crest: 'bush', arms: 'nubs', eyes: 'angry', mouth: 'grin' } },
    { id: 'laundry', name: 'Laundry Mimic', type: 'ground', taunt: 'Is it clean? Is it dirty? Nobody knows.', art: { body: 'block', m: '#C9A27A', a: '#7A5A44', a2: '#F0E2C8', eyes: 'angry', mouth: 'fang', pat: 'bands', crest: 'spikes' } },
    { id: 'gossip', name: 'Gossip Gale', type: 'flying', taunt: 'Did you hear? You have time for one more chat.', art: { body: 'egg', m: '#8FA8C0', b: '#E6EEF5', a: '#5A6E86', a2: '#F2C14E', wings: 'feather', mouth: 'beak', eyes: 'angry', crest: 'tuft', pat: 'belly', feet: 'stubby:G' } },
    { id: 'doomscroll', name: 'Doomscroll Wraith', type: 'dark', taunt: 'Just one more video. Then another.', art: { body: 'ghost', m: '#2B2340', a: '#58D0F0', a2: '#C8F6FF', eye: '#58D0F0', eyes: 'glow', mouth: 'grin', crest: 'hood+horns', aura: '@1' } },
    { id: 'midnight', name: 'Midnight Snack Shade', type: 'ghost', taunt: 'The fridge is calling. Answer it.', art: { body: 'ghost', m: '#7A7AB0', a: '#F2C14E', a2: '#FFF1A8', eyes: 'angry', mouth: 'open', crest: 'moon' } },
    { id: 'ping', name: 'Ping Phantom', type: 'ghost', taunt: 'Ding! Ding! Ding! Check your phone.', art: { body: 'drop', m: '#B8E0EC', a: '#E8604C', a2: '#FFD0C4', eyes: 'angry', mouth: 'open', crest: 'antenna', float: '@1' } },
    { id: 'sugarpixie', name: 'Sugar Pixie', type: 'fairy', taunt: 'Dessert first. Dinner never.', art: { body: 'drop', m: '#F8B8D8', a: '#E8604C', a2: '#FFF1A8', wings: 'fairy', eyes: 'angry', mouth: 'grin', crest: 'antenna', float: '@1', pat: 'stars' } },
    { id: 'glitter', name: 'Glitter Gremlin', type: 'fairy', taunt: 'Ooh, shiny new hobby! Drop the old one.', art: { body: 'round', m: '#C8A8F0', a: '#F2C14E', a2: '#FFFFFF', ears: 'point', eyes: 'angry', mouth: 'fang', pat: 'stars', tail: 'long' } },
    { id: 'overthink', name: 'Overthink Orb', type: 'psychic', taunt: 'But what if it goes wrong? What if? What if?', art: { body: 'round', m: '#8E6BD1', a: '#4A2F8A', a2: '#F2C14E', eyes: 'cyclops', crest: 'antenna+halo', float: '@1', aura: '@1', wings: 'bat' } },
  ];
  for (const b of BOSSES) if (b.art) { b.boss = true; b.names = ['x']; }

  /* Evolution levels by number of stages. */
  const EVO = { 4: [1, 8, 18, 30], 5: [1, 7, 15, 26, 40] };

  root.PALS = { TYPES, RARITY, FX, LINES, BOSSES, EVO, byId: Object.fromEntries(LINES.map((l, i) => [l.id, Object.assign(l, { no: i + 1 })])) };
})(typeof window !== 'undefined' ? (window.Q = window.Q || {}) : module.exports);
