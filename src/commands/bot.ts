import {
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	EmbedBuilder,
} from 'discord.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { version as djsVersion } from 'discord.js'

export const data = new SlashCommandBuilder()
	.setName('bot')
	.setDescription('Bot utilities')
	.addSubcommand(sub =>
		sub
			.setName('ping')
			.setDescription('Check latency quickly')
			.addBooleanOption(o =>
				o
					.setName('ephemeral')
					.setDescription('Only you can see it')
			),
	)
	.addSubcommand(sub =>
		sub
			.setName('stats')
			.setDescription('Runtime and cache stats')
			.addBooleanOption(o =>
				o
					.setName('ephemeral')
					.setDescription('Only you can see it')
			),
	)
	.addSubcommand(sub =>
		sub
			.setName('about')
			.setDescription('About this bot')
			.addBooleanOption(o =>
				o
					.setName('ephemeral')
					.setDescription('Only you can see it')
			),
	)

export async function execute (i: ChatInputCommandInteraction) {
	try {
		const sub = i.options.getSubcommand()
		if (sub === 'ping') return handlePing(i)
		if (sub === 'stats') return handleStats(i)
		if (sub === 'about') return handleAbout(i)

		await i.reply({
			content: 'Unknown subcommand.',
			ephemeral: true,
		})
	} catch (err) {
		console.error('bot command error:', err)
		try {
			if (i.deferred) {
				await i.editReply({
					content: 'Something went wrong.',
				})
			} else if (!i.replied) {
				await i.reply({
					content: 'Something went wrong.',
					ephemeral: true,
				})
			}
		} catch {}
	}
}

async function handlePing (i: ChatInputCommandInteraction) {
	const eph = i.options.getBoolean('ephemeral') ?? true
	const t0 = Date.now()
	await i.deferReply({ ephemeral: eph })
	const rest = Date.now() - t0
	const ws = Math.max(0, Math.round(i.client.ws.ping))

	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle('Pong!')
		.addFields(
			{ name: 'WebSocket', value: `${ws} ms`, inline: true },
			{ name: 'REST', value: `${rest} ms`, inline: true },
		)
		.setTimestamp(new Date())

	await i.editReply({ embeds: [embed] })
}

async function handleStats (i: ChatInputCommandInteraction) {
	const eph = i.options.getBoolean('ephemeral') ?? false
	const t0 = Date.now()
	await i.deferReply({ ephemeral: eph })
	const rest = Date.now() - t0
	const ws = Math.max(0, Math.round(i.client.ws.ping))

	const mem = process.memoryUsage()
	const rss = formatBytes(mem.rss)
	const heap = formatBytes(mem.heapUsed)
	const up = formatDuration(process.uptime())

	const guilds = i.client.guilds.cache.size
	const channels = i.client.channels.cache.size
	const users = i.client.users.cache.size

	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle('Bot stats')
		.addFields(
			{ name: 'WebSocket', value: `${ws} ms`, inline: true },
			{ name: 'REST', value: `${rest} ms`, inline: true },
			{ name: 'Uptime', value: up, inline: true },
			{ name: 'Memory (rss)', value: rss, inline: true },
			{ name: 'Memory (heap)', value: heap, inline: true },
			{ name: 'Guilds (cached)', value: `${guilds}`, inline: true },
			{ name: 'Channels (cached)', value: `${channels}`, inline: true },
			{ name: 'Users (cached)', value: `${users}`, inline: true },
			{
				name: 'Versions',
				value:
					`node ${process.version} • djs ${djsVersion} • ` +
					`bot ${getBotVersion()}`,
			},
			{
				name: 'Host',
				value: `${os.type()} ${os.release()} • ${os.arch()}`,
			},
		)
		.setTimestamp(new Date())

	await i.editReply({ embeds: [embed] })
}

async function handleAbout (i: ChatInputCommandInteraction) {
	const eph = i.options.getBoolean('ephemeral') ?? false
	await i.deferReply({ ephemeral: eph })

	// ensure application is hydrated for name/id
	try { await i.client.application?.fetch() } catch {}

	const app = i.client.application
	const name = app?.name ?? i.client.user?.username ?? 'Bot'
	const id = app?.id ?? i.client.user?.id ?? 'unknown'
	const created = i.client.user?.createdAt ?? new Date()

	const embed = new EmbedBuilder()
		.setColor(0x5865f2)
		.setTitle(name)
		.setDescription(
			'A lightweight leveling bot for Discord. ' +
			'Built with discord.js.',
		)
		.addFields(
			{ name: 'Application ID', value: id, inline: true },
			{
				name: 'Created',
				value: `<t:${Math.floor(created.getTime() / 1000)}:R>`,
				inline: true,
			},
			{
				name: 'Version',
				value: `bot ${getBotVersion()} • djs ${djsVersion}`,
				inline: true,
			},
		)
		.setTimestamp(new Date())

	await i.editReply({ embeds: [embed] })
}

function getBotVersion (): string {
	try {
		const p = path.resolve(process.cwd(), 'package.json')
		const raw = fs.readFileSync(p, 'utf8')
		const pkg = JSON.parse(raw) as { version?: string }
		return pkg.version ?? '0.0.0'
	} catch {
		return '0.0.0'
	}
}

function formatBytes (n: number): string {
	const units = ['B', 'KB', 'MB', 'GB']
	let u = 0
	let v = n
	while (v >= 1024 && u < units.length - 1) {
		v = v / 1024
		u++
	}
	return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`
}

function formatDuration (sec: number): string {
	const s = Math.floor(sec % 60)
	const m = Math.floor((sec / 60) % 60)
	const h = Math.floor((sec / 3600) % 24)
	const d = Math.floor(sec / 86400)
	const parts: string[] = []
	if (d) parts.push(`${d}d`)
	if (h) parts.push(`${h}h`)
	if (m) parts.push(`${m}m`)
	parts.push(`${s}s`)
	return parts.join(' ')
}