/**
 * The Terms of Use and Privacy Notice, in plain English. These describe what the site really does, so if
 * the site changes (what is stored, for how long, who it is shared with) change the words here too.
 * A paragraph is a string; an array of strings is a bullet list.
 */

export interface Section {
  title: string;
  body: (string | string[])[];
}

export const UPDATED = '24 October 2026';

export const TERMS: Section[] = [
  {
    title: 'What QChat is',
    body: [
      'QChat Reborn is a free chat site with rooms, private messages, shared videos and games. It is run by its administrators ("we" and "us"). These terms are the rules for using it. By creating an account or using the site you agree to them.',
    ],
  },
  {
    title: 'Who can use it',
    body: ['You must be 13 or over. If you are under 18, please make sure a parent or guardian is happy for you to use an online chat.'],
  },
  {
    title: 'Your account',
    body: [
      [
        'Choose a password only you know, and keep it private. You are responsible for what happens on your account.',
        'Do not share your account, and do not pretend to be someone else.',
        'You can delete your account at any time from the account menu. See the Privacy Notice for what that removes.',
      ],
    ],
  },
  {
    title: 'How we expect you to behave',
    body: [
      'Be decent to other people. You must not:',
      [
        'post anything illegal, or anything that sexualises or endangers children (we report this to the police)',
        'threaten, harass, bully or abuse other people, or encourage hatred or violence against people for who they are',
        'share other people\'s private information, or pictures of them, without their permission',
        'post spam, scams, malware, or links meant to trick people',
        'post pictures, videos or writing that you do not have the right to share',
        'record, screenshot or share someone else\'s live video without their permission, or show anything on camera that is unsuitable for a chat open to people aged 13 and over',
        'use the site to break the law',
        'try to break, overload or get into parts of the site that are not meant for you, or find a way round a ban, mute or limit',
      ],
    ],
  },
  {
    title: 'What you post',
    body: [
      'You keep ownership of what you write and share. By posting it you allow us to store it and to show it to the people in the room or conversation you posted it in, and to keep it as described in the Privacy Notice.',
      'Only post what you are happy for others to see. Messages in a room can be seen by everyone in that room, and people can copy them or take screenshots.',
    ],
  },
  {
    title: 'Moderation',
    body: [
      'Room owners and moderators can mute, remove or ban people from their rooms and delete messages. Administrators can do all of that across the whole site, and can also remove rooms and suspend or delete accounts.',
      'You can report a message using the flag button on it, and an administrator will look at it. We cannot read everything, so we cannot promise to catch everything, but we act when we are told.',
      'To help keep things tidy, administrators can block certain words, and new accounts cannot post links for a short while after they sign up. A message that breaks one of these rules is simply not sent.',
      'We may remove content or accounts that break these terms. For small things we will usually give a warning first. For serious things we will not.',
    ],
  },
  {
    title: 'Videos and other people\'s services',
    body: ['Videos, music and streams played in rooms come from YouTube, Vimeo, SoundCloud and Twitch. We do not host them, and they are covered by those services\' own terms. We are not responsible for what is in them.'],
  },
  {
    title: 'Private messages',
    body: [
      'Private messages are shown only to you and the person you wrote to. They are stored on our server and are not end-to-end encrypted, so the administrators who look after the server could technically read them. We will only do that if we need to deal with a report or a serious problem, or if the law requires it.',
    ],
  },
  {
    title: 'The service',
    body: [
      'QChat is free and is provided as it is. It may change, stop working for a while or close, and saved messages may be lost, so please do not rely on it for anything important.',
      'Nothing in these terms takes away any right you have by law, or limits responsibility that the law does not allow us to limit. Beyond that, as far as the law allows, we are not responsible for loss or damage from using this free service, or from what other members post.',
    ],
  },
  {
    title: 'Ending things',
    body: ['You can stop using QChat and delete your account whenever you like. We can suspend or delete accounts that break these terms.'],
  },
  {
    title: 'Changes to these terms',
    body: ['We may update these terms. If we make an important change we will say so on the site. If you keep using QChat after a change, that means you accept it.'],
  },
  {
    title: 'Which law applies',
    body: ['These terms are governed by the law of England and Wales.'],
  },
];

export const PRIVACY: Section[] = [
  {
    title: 'Who we are',
    body: [
      'QChat Reborn is run by its administrators, who decide how your information is used (the "data controller" in UK data protection law). You can contact us using the details at the bottom of this page.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      [
        'Your account: your username and your password. The password is kept only in a scrambled form that cannot be turned back into your password. We also note when you created the account and last signed in, and when you agreed to the terms.',
        'An email address, only if you choose to give one. We use it only to send you a link to confirm it, links to reset your password, and a notice if your password or address is changed. It is sent from our own mail server, never shared, and can be seen by administrators.',
        'Your profile, only what you choose to add: display name, pronouns, status, age, birthday (day and month only, and only shown if you tick it), gender, location, interests, a bio, a photo, your colours and your preferences. Other members see the parts you leave visible in Preferences.',
        'What you do on QChat: your messages in rooms, your private messages, pictures you share, reactions, who you are friends with and who you have blocked, reports you make, reminders you set with QBot, and your trivia scores.',
        'Technical information: your internet address (IP address) is seen by our servers whenever you connect. We use it to stop abuse, such as people guessing passwords or making lots of accounts, and failed sign in attempts are written to a log with it. It is not shown to other members.',
      ],
    ],
  },
  {
    title: 'Cookies and tracking',
    body: [
      'QChat does not set cookies of its own and does not use advertising or analytics. Your sign in is kept in your browser\'s session storage, which is cleared when you close the window, so you sign in again next time.',
      'When a video, track or stream is playing in a room, the player for that service (YouTube, Vimeo, SoundCloud or Twitch) loads in the page. That service may set its own cookies and see your IP address, under its own privacy policy. Nothing from them loads until something from that service is played. The typeface is served from this site, so opening QChat does not contact Google.',
      'WeatherBot sends the name of the place you ask about (for example London) to Open-Meteo to get the weather. It never sends who is asking.',
      'If a room owner switches on live video, anyone who joins the call connects directly to the other people in it. That means they can see your internet address, and QChat does not see or record the video. To set up that connection your browser asks a public connection server (Cloudflare\'s) for its own address, which means Cloudflare sees your internet address when you join a call. Nothing is sent unless you join.',
      'To show the title of a link that is queued or played, the QChat server asks that service for the title. This sends only the link, never anything about you.',
    ],
  },
  {
    title: 'Why we use it',
    body: [
      'We use your information to run the chat you signed up for, to keep it safe, and to deal with reports and problems. We do not sell it, and we do not use it for advertising.',
    ],
  },
  {
    title: 'Who can see it',
    body: [
      [
        'Other members can see your username, the parts of your profile you leave visible, and what you post in the rooms you are in. Friends can see when you are online.',
        'Only the person you write to can see a private message, but administrators who run the server have technical access to the database, which holds everything described here.',
        'We use a hosting company for the server. It can technically access the machine, but we do not give it your information for its own use.',
        'We will share information with the police or other authorities if the law requires it or if someone is at serious risk.',
      ],
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      [
        'Your account and profile: until you delete your account.',
        'Room messages: each room keeps its most recent 5,000 messages, and older ones are removed. Rooms that members create are deleted when nobody has used them for 30 days.',
        'Private messages: kept until you delete your account, with the oldest removed once a conversation passes 2,000 messages.',
        'Pictures: kept while a message uses them. Pictures that are no longer used are removed automatically, usually within a day or two.',
        'Sign in: your login lapses after 30 days without use.',
        'Backups: we keep nightly backups for 14 days, so anything you delete disappears from backups within 14 days.',
        'Server logs, including IP addresses: kept for a limited time for security and for fixing faults.',
      ],
    ],
  },
  {
    title: 'Your rights',
    body: [
      'You have the right to see, correct and delete your information, and to object to or restrict how it is used. Most of this you can do yourself:',
      [
        'See and take a copy: use "Download my data" in the account menu.',
        'Correct it: edit your profile, or change your password, in the account menu.',
        'Delete it: use "Delete my account" in the account menu. It removes your profile and photo, your messages in rooms, your private messages, your pictures, your friends list, your reports and your trivia scores.',
      ],
      'For anything else, contact us. If you are unhappy with how we have handled your information you can complain to the Information Commissioner\'s Office at ico.org.uk or on 0303 123 1113.',
    ],
  },
  {
    title: 'Children',
    body: ['QChat is for people aged 13 and over. If you think a younger child has an account, please tell us and we will remove it.'],
  },
  {
    title: 'Changes to this notice',
    body: ['If we change what we collect or how we use it, we will update this page and say so on the site.'],
  },
];
