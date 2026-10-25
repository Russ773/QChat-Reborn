/** Emoji you can type as :name: in a message. A name may have several aliases, separated by spaces. */
const TABLE: [string, string][] = [
  ['smile grin', '😀'], ['grinning', '😁'], ['joy lol', '😂'], ['rofl', '🤣'], ['blush', '😊'], ['heart_eyes', '😍'],
  ['sunglasses cool', '😎'], ['wink', '😉'], ['slight_smile', '🙂'], ['sweat_smile', '😅'], ['innocent angel', '😇'],
  ['thinking hmm', '🤔'], ['neutral', '😐'], ['sleeping zzz', '😴'], ['sob cry', '😭'], ['triumph', '😤'],
  ['scream', '😱'], ['partying party', '🥳'], ['sad', '😢'], ['stuck_out_tongue_wink', '😜'], ['raised_eyebrow', '🤨'],
  ['rolling_eyes eyeroll', '🙄'], ['grimacing', '😬'], ['hugs hug', '🤗'], ['thumbsup +1 yes', '👍'], ['thumbsdown -1 no', '👎'],
  ['clap', '👏'], ['raised_hands', '🙌'], ['pray please thanks', '🙏'], ['muscle strong', '💪'], ['handshake', '🤝'], ['wave hello hi', '👋'],
  ['heart love', '❤️'], ['fire lit', '🔥'], ['sparkles', '✨'], ['star', '⭐'], ['tada', '🎉'], ['notes music', '🎶'],
  ['100', '💯'], ['eyes', '👀'], ['exploding_head mindblown', '🤯'], ['cold_face', '🥶'], ['star_struck', '🤩'], ['salute', '🫡'],
  ['melting', '🫠'], ['skull dead', '💀'], ['clapper movie', '🎬'], ['tv', '📺'], ['pizza', '🍕'], ['coffee', '☕'],
  ['beer', '🍺'], ['video_game game', '🎮'], ['soccer football', '⚽'], ['rocket', '🚀'], ['rainbow', '🌈'], ['check white_check_mark', '✅'],
  ['x cross', '❌'], ['warning', '⚠️'], ['question', '❓'], ['exclamation', '❗'], ['zap lightning', '⚡'], ['sun', '☀️'],
  ['moon', '🌙'], ['cloud', '☁️'], ['umbrella rain', '☔'], ['snowflake', '❄️'], ['earth world', '🌍'], ['tree', '🌳'],
  ['flower', '🌸'], ['rose', '🌹'], ['sunflower', '🌻'], ['dog', '🐶'], ['cat', '🐱'], ['mouse', '🐭'],
  ['rabbit bunny', '🐰'], ['fox', '🦊'], ['bear', '🐻'], ['panda', '🐼'], ['penguin', '🐧'], ['chicken', '🐔'],
  ['unicorn', '🦄'], ['bee', '🐝'], ['butterfly', '🦋'], ['turtle', '🐢'], ['octopus', '🐙'], ['dolphin', '🐬'],
  ['whale', '🐳'], ['shark', '🦈'], ['burger hamburger', '🍔'], ['fries', '🍟'], ['hotdog', '🌭'], ['taco', '🌮'],
  ['sushi', '🍣'], ['ramen noodles', '🍜'], ['cake birthday', '🎂'], ['cookie', '🍪'], ['donut', '🍩'], ['icecream', '🍦'],
  ['chocolate', '🍫'], ['apple', '🍎'], ['banana', '🍌'], ['strawberry', '🍓'], ['watermelon', '🍉'], ['avocado', '🥑'],
  ['wine', '🍷'], ['cocktail', '🍸'], ['tea', '🍵'], ['champagne', '🍾'], ['gift present', '🎁'], ['balloon', '🎈'],
  ['trophy', '🏆'], ['medal', '🏅'], ['dart bullseye', '🎯'], ['dice', '🎲'], ['guitar', '🎸'], ['microphone mic', '🎤'],
  ['headphones', '🎧'], ['camera', '📷'], ['phone', '📱'], ['computer laptop', '💻'], ['keyboard', '⌨️'], ['bulb idea', '💡'],
  ['book', '📖'], ['pencil', '✏️'], ['memo note', '📝'], ['lock', '🔒'], ['key', '🔑'], ['bell', '🔔'],
  ['mute', '🔇'], ['loud_sound sound', '🔊'], ['hourglass', '⏳'], ['clock', '🕐'], ['calendar', '📅'], ['money_bag money', '💰'],
  ['gem diamond', '💎'], ['crown', '👑'], ['ghost', '👻'], ['alien', '👽'], ['robot', '🤖'], ['poop', '💩'],
  ['clown', '🤡'], ['nerd', '🤓'], ['zany crazy', '🤪'], ['yum', '😋'], ['kiss', '😘'], ['smirk', '😏'],
  ['unamused', '😒'], ['pensive', '😔'], ['worried', '😟'], ['angry', '😠'], ['rage', '🤬'], ['flushed', '😳'],
  ['confused', '😕'], ['sleepy', '😪'], ['sick', '🤢'], ['mask', '😷'], ['cowboy', '🤠'], ['shrug', '🤷'],
  ['facepalm', '🤦'], ['point_up', '☝️'], ['point_right', '👉'], ['point_left', '👈'], ['ok_hand ok', '👌'], ['peace victory', '✌️'],
  ['crossed_fingers luck', '🤞'], ['fist', '✊'], ['punch', '👊'], ['broken_heart', '💔'], ['blue_heart', '💙'], ['green_heart', '💚'],
  ['yellow_heart', '💛'], ['purple_heart', '💜'], ['black_heart', '🖤'], ['sparkling_heart', '💖'], ['car', '🚗'], ['bike', '🚲'],
  ['airplane plane', '✈️'], ['ship', '🚢'], ['house home', '🏠'], ['beach', '🏖️'], ['mountain', '⛰️'], ['tent camping', '⛺'],
];

/** name -> emoji (every alias). */
export const SHORTCODES: Record<string, string> = {};
/** One entry per emoji, for the suggestion list: its main name and aliases. */
export const SHORTCODE_LIST: { name: string; names: string[]; emoji: string }[] = [];

for (const [names, emoji] of TABLE) {
  const all = names.split(' ');
  SHORTCODE_LIST.push({ name: all[0], names: all, emoji });
  for (const n of all) SHORTCODES[n] = emoji;
}

/** Emoji whose name starts with, or failing that contains, what was typed. */
export function suggestEmoji(query: string, limit = 7): { name: string; emoji: string }[] {
  const q = query.toLowerCase();
  const starts: { name: string; emoji: string }[] = [];
  const has: { name: string; emoji: string }[] = [];
  for (const e of SHORTCODE_LIST) {
    if (e.names.some((n) => n.startsWith(q))) starts.push({ name: e.name, emoji: e.emoji });
    else if (e.names.some((n) => n.includes(q))) has.push({ name: e.name, emoji: e.emoji });
  }
  return [...starts, ...has].slice(0, limit);
}
