/** The slash commands, for /help and the client's command hints. */
export interface CommandHelp {
  usage: string;
  desc: string;
  /** Who can use it: everyone, room moderators and up, or room owners and up. */
  level?: 'mod' | 'owner';
}

export const COMMANDS: CommandHelp[] = [
  { usage: '/help', desc: 'Show this list' },
  { usage: '/me <action>', desc: 'Say something in the third person, like "/me waves"' },
  { usage: '/msg <member> <text>', desc: 'Send a private message (also /w and /dm)' },
  { usage: '/whois <member>', desc: 'See who someone is and where they are' },
  { usage: '/topic [text]', desc: 'Show the room topic, or set it if you are a moderator' },
  { usage: '/away [message]', desc: 'Mark yourself away (and /back to return)' },
  { usage: '/block <member>', desc: 'Stop seeing their messages and stop them messaging you' },
  { usage: '/unblock <member>', desc: 'Undo a block (see yours with /blocks)' },
  { usage: '/clear', desc: 'Clear this room from your screen' },
  { usage: '/kick <member> [reason]', desc: 'Remove someone from the room', level: 'mod' },
  { usage: '/mute <member> [minutes] [reason]', desc: 'Stop someone talking (default 10 minutes, 0 is until unmuted)', level: 'mod' },
  { usage: '/unmute <member>', desc: 'Let someone talk again', level: 'mod' },
  { usage: '/ban <member> [reason]', desc: 'Remove someone and stop them rejoining', level: 'mod' },
  { usage: '/unban <member>', desc: 'Let a banned member back in (see them with /bans)', level: 'mod' },
  { usage: '/mod <member>', desc: 'Make someone a room moderator (/unmod to undo)', level: 'owner' },
  { usage: '/deleteroom', desc: 'Delete this room and everything in it', level: 'owner' },
];
