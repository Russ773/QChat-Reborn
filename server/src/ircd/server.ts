import {
  encodeMediaEvent,
  parseMediaEvent,
  type IrcMessage,
  type MediaClientEvent,
  type MediaState,
} from '@qchat/shared';
import { MediaCoordinator, classifyUrl } from '../media/coordinator.js';
import { Channel } from './channel.js';
import type { Connection } from './connection.js';
import { ERR, RPL } from './numerics.js';
import { User } from './user.js';

const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,31}$/;

/**
 * The QChat IRC daemon. Owns all users and channels, dispatches commands, and
 * coordinates watch-party media on top of the chat protocol.
 */
export class IrcServer {
  private users = new Set<User>();
  private nicks = new Map<string, User>(); // lowercased nick -> user
  private channels = new Map<string, Channel>(); // lowercased name -> channel
  private media = new MediaCoordinator();

  constructor(
    readonly serverName = 'qchat.local',
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Register a freshly accepted connection with the server. */
  accept(connection: Connection): void {
    const user = new User(connection, this.serverName);
    // Browser (WebSocket) clients speak the MEDIA extension by default; raw IRC
    // clients must opt in via CAP so they aren't sent commands they can't parse.
    user.supportsMedia = connection.kind === 'ws';
    this.users.add(user);

    connection.onMessage = (message) => {
      try {
        this.dispatch(user, message);
      } catch (err) {
        this.log(`error handling ${message.command}: ${(err as Error).message}`);
      }
    };
    connection.onClose = () => this.handleClose(user);
  }

  private dispatch(user: User, message: IrcMessage): void {
    switch (message.command) {
      case 'CAP':
        return this.handleCap(user, message);
      case 'NICK':
        return this.handleNick(user, message);
      case 'USER':
        return this.handleUser(user, message);
      case 'PING':
        return user.sendFromServer('PONG', [this.serverName, message.params[0] ?? '']);
      case 'PONG':
        return;
      case 'QUIT':
        return this.handleQuit(user, message.params[0] ?? 'Client quit');
      default:
        break;
    }

    if (!user.registered) {
      return user.sendNumeric(ERR.NOTREGISTERED, ['You have not registered']);
    }

    switch (message.command) {
      case 'JOIN':
        return this.handleJoin(user, message);
      case 'PART':
        return this.handlePart(user, message);
      case 'PRIVMSG':
        return this.handlePrivmsg(user, message, false);
      case 'NOTICE':
        return this.handlePrivmsg(user, message, true);
      case 'NAMES':
        return this.handleNames(user, message);
      case 'WHO':
        return this.handleWho(user, message);
      case 'LIST':
        return this.handleList(user);
      case 'MEDIA':
        return this.handleMedia(user, message);
      default:
        return user.sendNumeric(ERR.UNKNOWNCOMMAND, [
          message.command,
          'Unknown command',
        ]);
    }
  }

  // --- Registration -------------------------------------------------------

  private handleCap(user: User, message: IrcMessage): void {
    const sub = (message.params[0] ?? '').toUpperCase();
    if (sub === 'LS') {
      user.sendFromServer('CAP', ['*', 'LS', 'message-tags qchat/media']);
    } else if (sub === 'REQ') {
      const requested = (message.params[1] ?? '').split(' ').filter(Boolean);
      if (requested.includes('qchat/media')) user.supportsMedia = true;
      user.sendFromServer('CAP', ['*', 'ACK', requested.join(' ')]);
    } else if (sub === 'END') {
      /* nothing extra needed; registration proceeds on NICK+USER */
    }
  }

  private handleNick(user: User, message: IrcMessage): void {
    const desired = message.params[0];
    if (!desired) return user.sendNumeric(ERR.NONICKNAMEGIVEN, ['No nickname given']);
    if (!NICK_RE.test(desired)) {
      return user.sendNumeric(ERR.ERRONEUSNICKNAME, [desired, 'Erroneous nickname']);
    }
    const key = desired.toLowerCase();
    const existing = this.nicks.get(key);
    if (existing && existing !== user) {
      return user.sendNumeric(ERR.NICKNAMEINUSE, [desired, 'Nickname is already in use']);
    }

    const oldNick = user.nick;
    if (user.registered) {
      // Live rename: announce to everyone who shares a channel.
      this.nicks.delete(oldNick.toLowerCase());
      user.nick = desired;
      this.nicks.set(key, user);
      const announce: IrcMessage = {
        prefix: `${oldNick}!${user.username}@${user.connection.remote}`,
        command: 'NICK',
        params: [desired],
      };
      user.send(announce);
      for (const chanKey of user.channels) {
        this.channels.get(chanKey)?.broadcast(announce, user);
      }
    } else {
      user.nick = desired;
      this.nicks.set(key, user);
      this.maybeCompleteRegistration(user);
    }
  }

  private handleUser(user: User, message: IrcMessage): void {
    if (user.registered) {
      return user.sendNumeric(ERR.ALREADYREGISTERED, ['You may not reregister']);
    }
    if (message.params.length < 4) {
      return user.sendNumeric(ERR.NEEDMOREPARAMS, ['USER', 'Not enough parameters']);
    }
    user.username = message.params[0];
    user.realname = message.params[3];
    this.maybeCompleteRegistration(user);
  }

  private maybeCompleteRegistration(user: User): void {
    if (user.registered) return;
    if (user.nick === '*' || !user.username) return;
    user.registered = true;

    user.sendNumeric(RPL.WELCOME, [
      `Welcome to QChat, ${user.nick}!${user.username}@${user.connection.remote}`,
    ]);
    user.sendNumeric(RPL.YOURHOST, [`Your host is ${this.serverName}, running QChat ircd`]);
    user.sendNumeric(RPL.CREATED, ['This server is powered by QChat - Reborn']);
    user.sendNumeric(RPL.MYINFO, [this.serverName, 'qchat-0.1', 'o', 'nt']);
    this.log(`${user.nick} registered from ${user.connection.remote}`);
  }

  // --- Channels -----------------------------------------------------------

  private getOrCreateChannel(name: string): Channel {
    const key = name.toLowerCase();
    let channel = this.channels.get(key);
    if (!channel) {
      channel = new Channel(name);
      this.channels.set(key, channel);
    }
    return channel;
  }

  private handleJoin(user: User, message: IrcMessage): void {
    const target = message.params[0];
    if (!target) return user.sendNumeric(ERR.NEEDMOREPARAMS, ['JOIN', 'Not enough parameters']);

    for (const rawName of target.split(',')) {
      const name = rawName.trim();
      if (!name.startsWith('#') && !name.startsWith('&')) {
        user.sendNumeric(ERR.NOSUCHCHANNEL, [name, 'Invalid channel name']);
        continue;
      }
      const channel = this.getOrCreateChannel(name);
      if (channel.has(user)) continue;

      channel.add(user);
      user.channels.add(channel.key);

      const joinMsg: IrcMessage = {
        prefix: user.hostmask,
        command: 'JOIN',
        params: [channel.name],
      };
      channel.broadcast(joinMsg); // includes the joiner

      if (channel.topic) {
        user.sendNumeric(RPL.TOPIC, [channel.name, channel.topic]);
      } else {
        user.sendNumeric(RPL.NOTOPIC, [channel.name, 'No topic is set']);
      }
      this.sendNames(user, channel);

      // Sync the newcomer to the channel's current watch-party state.
      const state = this.media.getState(channel.key);
      if (state && user.supportsMedia) this.sendMediaState(user, state);
    }
  }

  private handlePart(user: User, message: IrcMessage): void {
    const target = message.params[0];
    if (!target) return user.sendNumeric(ERR.NEEDMOREPARAMS, ['PART', 'Not enough parameters']);
    const reason = message.params[1] ?? '';

    for (const rawName of target.split(',')) {
      const channel = this.channels.get(rawName.trim().toLowerCase());
      if (!channel || !channel.has(user)) {
        user.sendNumeric(ERR.NOTONCHANNEL, [rawName, "You're not on that channel"]);
        continue;
      }
      const partMsg: IrcMessage = {
        prefix: user.hostmask,
        command: 'PART',
        params: reason ? [channel.name, reason] : [channel.name],
      };
      channel.broadcast(partMsg);
      this.leaveChannel(user, channel);
    }
  }

  private leaveChannel(user: User, channel: Channel): void {
    channel.remove(user);
    user.channels.delete(channel.key);
    if (channel.empty) {
      this.channels.delete(channel.key);
      this.media.dispose(channel.key);
    }
  }

  private sendNames(user: User, channel: Channel): void {
    const names = [...channel.members].map((m) => m.nick).join(' ');
    user.sendNumeric(RPL.NAMREPLY, ['=', channel.name, names]);
    user.sendNumeric(RPL.ENDOFNAMES, [channel.name, 'End of /NAMES list']);
  }

  private handleNames(user: User, message: IrcMessage): void {
    const target = message.params[0];
    if (!target) return user.sendNumeric(RPL.ENDOFNAMES, ['*', 'End of /NAMES list']);
    const channel = this.channels.get(target.trim().toLowerCase());
    if (channel) this.sendNames(user, channel);
    else user.sendNumeric(RPL.ENDOFNAMES, [target, 'End of /NAMES list']);
  }

  private handleWho(user: User, message: IrcMessage): void {
    const target = message.params[0] ?? '';
    const channel = this.channels.get(target.trim().toLowerCase());
    if (channel) {
      for (const member of channel.members) {
        user.sendNumeric(RPL.WHOREPLY, [
          channel.name,
          member.username || '~' + member.nick,
          member.connection.remote,
          this.serverName,
          member.nick,
          'H',
          `0 ${member.realname}`,
        ]);
      }
    }
    user.sendNumeric(RPL.ENDOFWHO, [target || '*', 'End of /WHO list']);
  }

  private handleList(user: User): void {
    user.sendNumeric(RPL.LISTSTART, ['Channel', 'Users Name']);
    for (const channel of this.channels.values()) {
      user.sendNumeric(RPL.LIST, [
        channel.name,
        String(channel.members.size),
        channel.topic,
      ]);
    }
    user.sendNumeric(RPL.LISTEND, ['End of /LIST']);
  }

  // --- Messaging ----------------------------------------------------------

  private handlePrivmsg(user: User, message: IrcMessage, isNotice: boolean): void {
    const command = isNotice ? 'NOTICE' : 'PRIVMSG';
    const target = message.params[0];
    const text = message.params[1];
    if (!target) {
      if (!isNotice) user.sendNumeric(ERR.NORECIPIENT, [`No recipient given (${command})`]);
      return;
    }
    if (text === undefined || text === '') {
      if (!isNotice) user.sendNumeric(ERR.NOTEXTTOSEND, ['No text to send']);
      return;
    }

    const out: IrcMessage = {
      prefix: user.hostmask,
      command,
      params: [target, text],
    };

    if (target.startsWith('#') || target.startsWith('&')) {
      const channel = this.channels.get(target.toLowerCase());
      if (!channel) {
        if (!isNotice) user.sendNumeric(ERR.NOSUCHNICK, [target, 'No such channel']);
        return;
      }
      if (!channel.has(user)) {
        if (!isNotice) {
          user.sendNumeric(ERR.CANNOTSENDTOCHAN, [target, 'Cannot send to channel']);
        }
        return;
      }
      channel.broadcast(out, user); // don't echo back to the sender
    } else {
      const dest = this.nicks.get(target.toLowerCase());
      if (!dest) {
        if (!isNotice) user.sendNumeric(ERR.NOSUCHNICK, [target, 'No such nick']);
        return;
      }
      dest.send(out);
    }
  }

  // --- Media --------------------------------------------------------------

  private handleMedia(user: User, message: IrcMessage): void {
    const target = message.params[0];
    const payload = message.params[1];
    if (!target || payload === undefined) {
      return user.sendNumeric(ERR.NEEDMOREPARAMS, ['MEDIA', 'Not enough parameters']);
    }
    const channel = this.channels.get(target.toLowerCase());
    if (!channel || !channel.has(user)) {
      return user.sendNumeric(ERR.CANNOTSENDTOCHAN, [target, 'Cannot control media here']);
    }
    const event = parseMediaEvent(payload);
    if (!event || event.t === 'state') return; // ignore malformed / server-only events

    const newState = this.media.handle(
      channel.key,
      channel.name,
      event as MediaClientEvent,
      user.nick,
    );
    if (!newState) return;

    // Broadcast the authoritative snapshot to media-capable members.
    for (const member of channel.members) {
      if (member.supportsMedia) this.sendMediaState(member, newState);
    }

    // Plain-text fallback so non-media IRC clients still see what was shared.
    if (event.t === 'enqueue') {
      const { kind } = classifyUrl(event.url);
      const noun = kind === 'audio' ? 'audio' : kind === 'unknown' ? 'link' : 'video';
      const notice: IrcMessage = {
        prefix: user.hostmask,
        command: 'PRIVMSG',
        params: [channel.name, `ACTION shared a ${noun}: ${event.url}`],
      };
      for (const member of channel.members) {
        if (!member.supportsMedia && member !== user) member.send(notice);
      }
    }
  }

  private sendMediaState(user: User, state: MediaState): void {
    user.send({
      prefix: this.serverName,
      command: 'MEDIA',
      params: [state.channel, encodeMediaEvent({ t: 'state', state })],
    });
  }

  // --- Teardown -----------------------------------------------------------

  private handleQuit(user: User, reason: string): void {
    const quitMsg: IrcMessage = {
      prefix: user.hostmask,
      command: 'QUIT',
      params: [reason],
    };
    const notified = new Set<User>();
    for (const chanKey of user.channels) {
      const channel = this.channels.get(chanKey);
      if (!channel) continue;
      for (const member of channel.members) {
        if (member !== user) notified.add(member);
      }
    }
    for (const member of notified) member.send(quitMsg);
    user.connection.close();
  }

  private handleClose(user: User): void {
    for (const chanKey of [...user.channels]) {
      const channel = this.channels.get(chanKey);
      if (channel) {
        const quitMsg: IrcMessage = {
          prefix: user.hostmask,
          command: 'QUIT',
          params: ['Connection closed'],
        };
        channel.broadcast(quitMsg, user);
        this.leaveChannel(user, channel);
      }
    }
    if (user.nick !== '*') this.nicks.delete(user.nick.toLowerCase());
    this.users.delete(user);
    this.log(`${user.nick} disconnected`);
  }
}
