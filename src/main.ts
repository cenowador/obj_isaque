import { Client, Message, GuildMember, TextChannel, Guild, Role, ChannelLogsQueryOptions } from "discord.js";
import {
	Server, Command, devs, Arguments, charCodeOf, Argument, ArgumentKind,
	parseTime, discordErrorHandler, Permission, Channels, defaultErrorHandler,
	notNull, validatePermissions, Roles, Emojis, emptyEmbed, defaultEmbed, cursedInvites, formatTime, dateOf, Time
} from "./defs";
import * as Moderation from "./moderation";
import * as Database from "./database";
import * as Balance from "./balance";
import * as Giveaway from "./giveaway";
import * as fs from "fs";
import commands from "./commands";

const auth = JSON.parse(fs.readFileSync("auth.json", "utf8"));
Server.specialInvite = auth.invite;
const client = new Client();
type Invites = { [key: string]: number };
let invites: Invites = {};

const timeout = <{ [key: string]: number }>{};

function parseArgs(raw: string[], msg: Message): Arguments {
	const result = <Arguments>[];

	for (let str of raw) {
		let arg = <Argument>{};

		// if everything below fails, it's a string
		arg.kind = ArgumentKind.STRING;
		arg.value = str;

		result.push(arg);

		// parse as member or channel
		if (str[0] === '<') {
			str = str.substr(1);
			if (str[0] === '@') {
				str = str.substr(1 + Number(str[1] === '!'));

				const id = str.substr(0, 18);

				if (msg.guild === null) continue;
				const member = msg.guild.members.cache.get(id);

				if (member === undefined) {
					arg.kind = ArgumentKind.USERID;
					arg.value = id;
				} else {
					arg.kind = ArgumentKind.MEMBER;
					arg.value = member;
				}
			} else if (str[0] === '#') {
				str = str.substr(1);

				const id = str.substr(0, 18);

				if (msg.guild === null) continue;
				const channel = msg.guild.channels.cache.get(id);

				if (channel === undefined) continue;
				arg.kind = ArgumentKind.CHANNEL;
				arg.value = channel;
			} else if (str[0] === ':' || str.startsWith("a:")) {
				const last = str.indexOf(':', 2);
				const id = str.substr(last + 1, 18);

				const emoji = client.emojis.cache.get(id);
				if (emoji === undefined) continue;
				arg.kind = ArgumentKind.EMOJI;
				arg.value = emoji;
			}

			continue;
		}

		let code = str.charCodeAt(0);

		// parse as number or time
		if (code >= charCodeOf('0') && code <= charCodeOf('9')) {

			// 18 chars, check if it's an ID
			if (str.length == 18) {
				let isntId = false;

				for (let i = 1; i < str.length; ++i) {
					const code = str.charCodeAt(i);

					if (code < charCodeOf('0') || code > charCodeOf('9')) {
						isntId = true;
						break;
					}
				}

				if (!isntId) {
					arg.kind = ArgumentKind.USERID;
					arg.value = str;
					continue;
				}
			}

			const v = parseFloat(str);

			// parse as time if the length doesn't match
			if (String(v).length !== str.length) {
				const result = parseTime(str);

				if (result.success) {
					arg.kind = ArgumentKind.TIME;
					arg.value = result.data;
				}
			} else {
				arg.kind = ArgumentKind.NUMBER;
				arg.value = v;
			}
		}
	}

	return result;
}

function predictResponse(msg: Message) {
	if (msg.content.toLowerCase().includes("sentido da vida")) {
		msg.channel.send(`${msg.author} é simples: 42`).catch(defaultErrorHandler);
		return true;
	}

	return false;
}

async function fetchInvites(guild?: Guild) {
	const inv = await (guild ?? client.guilds.cache.get(Server.id))?.fetchInvites()
	if (inv) {
		const invites: Invites = {};
		inv.forEach((value) => invites[value.code] = value.uses ?? 0);
		return invites;
	}

	return undefined;
}

function removeAndReward(channel: TextChannel) {
	channel.messages.fetch()
		.then(messages => {
			messages.forEach(value => {

				function prizeWith(qnt: number) {
					const result = Balance.prize([value.author.id], qnt)[0];
					if (!result.success) {
						let channel = <TextChannel>value.guild?.channels.cache.get("671327942420201492");
						if (!channel || channel.type !== "text")
							return;

						channel.send(`${value.author} Você não está registrado, então você não pode receber pelo like/review que você fez enviada no <#${Channels.steamReviews}>`)
					}
				}

				if (value.content.includes("steamcommunity.com/")) {
					const reaction = value.reactions.cache.get(Emojis.yes);
					if (!reaction)
						return;

					reaction.users.fetch().then(users => {
						let member: GuildMember | undefined;
						if (users.some(user => (
							member = channel.members.get(user.id),
							member && validatePermissions(member, channel, Permission.MOD)) ?? false)
						) {
							reaction.remove();
							prizeWith(100);
						}
					});
				} else if (
					!value.pinned && Date.now() - value.createdTimestamp > Time.day &&
					value.attachments.some(attachment => attachment.width !== null)
				) {
					value.delete();
					prizeWith(10);
				}
			});

			setTimeout(removeAndReward, Time.minute * 5, channel);
		})
		.catch(discordErrorHandler);
}

client.on("inviteCreate", invite => {
	invites[invite.code] = invite.uses ?? 0;
});

client.on("ready", async () => {
	try {
		await Database.init(auth.mongoURI, auth.mongo);
		await Moderation.init(client);
		await Balance.init(client);
		await Giveaway.init(client);
	} catch (err) {
		defaultErrorHandler(err);
	}

	try {
		// @NOTE(luigi): what?
		invites = (await fetchInvites()) ?? {};

		notNull(client.user).setPresence({ activity: { name: "o curso do NoNe!", type: "WATCHING" }, status: "online" });

		const guild = client.guilds.cache.get(Server.id);
		if (!guild)
			return;

		// Fetching messages
		(<TextChannel>guild.channels.cache.get(Channels.rules)).messages.fetch();

		// log de punições
		let channel = guild.channels.cache.get(Channels.log);
		if (!channel || channel.type !== "text")
			return;

		Channels.logObject = <TextChannel>channel;

		// join log
		channel = guild.channels.cache.get(Channels.joinLog);
		if (!channel || channel.type !== "text")
			return;

		Channels.joinLogObject = <TextChannel>channel;

		// Steam Reviews
		channel = guild.channels.cache.get(Channels.steamReviews);
		if (!channel || channel.type !== "text")
			return;
		removeAndReward(<TextChannel>channel);
	} catch (err) {
		discordErrorHandler(err);
	}

	console.log("Online!");
});

client.on("messageReactionAdd", (reaction, user) => {
	if (reaction.message.id !== Server.rolepickMsg)
		return;

	const member = reaction.message.guild?.members.cache.get(user.id);

	if (!member)
		return;

	if (reaction.emoji.id === Emojis.unity && !member.roles.cache.has(Roles.unity)) // unity
		member.roles.add(Roles.unity).catch(discordErrorHandler);
	else if (reaction.emoji.id === Emojis.gamemaker && !member.roles.cache.has(Roles.gamemaker)) // game maker
		member.roles.add(Roles.gamemaker).catch(discordErrorHandler);
});

client.on("error", discordErrorHandler);

client.on("messageReactionRemove", (reaction, user) => {
	if (reaction.message.id !== Server.rolepickMsg)
		return;

	const member = reaction.message.guild?.members.cache.get(user.id);

	if (!member)
		return;

	if (reaction.emoji.id === Emojis.unity && member.roles.cache.has(Roles.unity)) // unity
		member.roles.remove(Roles.unity).catch(discordErrorHandler);
	else if (reaction.emoji.id === Emojis.gamemaker && member.roles.cache.has(Roles.gamemaker)) // game maker
		member.roles.remove(Roles.gamemaker).catch(discordErrorHandler);
});

client.on("guildMemberAdd", async member => {
	if (member.guild.id !== Server.id) return;
	if (Moderation.isMuted(member.id))
		member.roles.add(Roles.muted).catch(discordErrorHandler);

	const newInvites = (<Invites>await fetchInvites().catch(discordErrorHandler));

	let invite: string | undefined;
	if (newInvites[Server.specialInvite] > invites[Server.specialInvite]) {
		member.roles.add(Roles.aluno).catch(discordErrorHandler);

		invite = Server.specialInvite;
	} else {
		const keys = Object.keys(invites);
		for (const key of keys) {
			if (invites[key] < newInvites[key]) {
				invite = key;
				break;
			}
		}
	}

	let banned = false;
	if (cursedInvites.includes(invite ?? "")) {
		banned = true;
		member.ban({ reason: "Cursed invite: " + invite });
		Channels.logObject.send(emptyEmbed().setDescription(`SINTA O PODER DO MARTELO! SEU CONVITE O AMALDIÇOOU! ${member}`));
	}

	invites = newInvites;

	const embed = defaultEmbed(member);

	embed.title = "Member Joined";
	embed.description = "";
	if (banned)
		embed.description += "[Cursed Invite] ";

	embed.description += member.toString();
	embed.addField("ID", member.id, true);

	let age = "Desconhecido (é null, fazer o quê)";
	if (member.user?.createdTimestamp)
		age = dateOf(member.user.createdTimestamp);

	embed.addField("Creation Date", age, true);
	embed.addField("Invite", invite ?? "noneclass", true);

	const user = member.user;
	if (user)
		embed.addField("Username", user.tag, true);

	Channels.joinLogObject.send(embed).catch(discordErrorHandler);
});

client.on("guildMemberRemove", member => {
	const embed = defaultEmbed(member);

	embed.title = "Member Left";
	embed.description = member.toString();
	embed.addField("ID", member.id, true);
	if (member.user)
		embed.addField("Username", member.user.tag, true);

	if (member.roles.cache.size > 0) {
		embed.addField("Roles", member.roles.cache.array().join(' '));
	}

	Channels.joinLogObject.send(embed).catch(discordErrorHandler);
});

client.on("voiceStateUpdate", (state0, state1) => {
	if (!state1.channelID) return;
	if (state1.channelID === state0.channelID) return;

	if (!state1.member || state1.guild.id !== Server.id)
		return;

	if (Moderation.isMuted(state1.member.id)) {
		if (!state1.mute) state1.setMute(true).catch(discordErrorHandler);
	} else {
		if (state1.mute) state1.setMute(false).catch(discordErrorHandler);
	}
});

client.on("message", (message) => {
	if (message.author.bot || message.channel.type === "dm" || message.guild === null)
		return;

	Balance.onMessage(message);

	// answer question
	if (message.mentions.members?.has(notNull(client.user).id) && message.content.endsWith('?')) {
		timeout[message.author.id] = Date.now();
		const respostas = [
			"Sim",
			"Não",
			"depende",
			"obviamente",
			"talvez...",
			`não sei. Pergunta pro(a) ${message.guild?.members.cache.random().displayName}!`,
			"não quero falar contigo. sai",
			"hmmmm... Já tentou apagar a system32?",
		];
		if (!predictResponse(message)) {
			message.channel.send(
				`${message.author} ${respostas[Math.floor(Math.random() * respostas.length)]
				}`,
			).catch(defaultErrorHandler);
		}
	}

	if (!message.content.startsWith(Server.prefix))
		return;

	// timeout
	if (!message.member?.hasPermission("ADMINISTRATOR") && (timeout[message.author.id] ?? 0) + Server.timeout > Date.now()) {
		message.react(Emojis.no).catch(discordErrorHandler);
		return;
	}

	const rawArgs = message.content.slice(Server.prefix.length).split(' ').filter(s => s !== "");

	let command: Command | undefined;
	for (const cmd of commands) {
		if (cmd.aliases.includes(rawArgs[0])) {
			command = cmd;
			break;
		}
	}

	if (command === undefined || !message.member || !validatePermissions(message.member, message.channel, command.permissions))
		return;

	const args = parseArgs(rawArgs, message);

	timeout[message.author.id] = Date.now();

	command.run(message, args, rawArgs).catch(e => {
		console.log(e);
		message.channel.send(`<@${devs[0]}> aconteceu algo de errado, dá uma olhadinha no console aí`)
			.catch(discordErrorHandler);
	});
});

process.on("beforeExit", async () => {
	await Balance.onExit().catch(defaultErrorHandler);
	await Database.done().catch(defaultErrorHandler);
});

client.login(auth.token);