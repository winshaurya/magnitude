<p align="center">
  <img src="wordmark.svg" alt="Magnitude" width="100%" />
</p>

<p align="center">
  <a href="https://docs.magnitude.dev" target="_blank"><img src="https://img.shields.io/badge/📕-Docs-232f41?style=flat-square&labelColor=0369a1&color=gray" alt="Documentation" /></a> <a href="https://app.magnitude.dev" target="_blank"><img src="https://img.shields.io/badge/%F0%9F%96%A5-Console-232f41?style=flat-square&labelColor=0369a1&color=gray" alt="Console" /></a> <img src="https://img.shields.io/badge/License-Apache%202.0-232f41?style=flat-square&labelColor=0369a1&color=gray" alt="License" /> <a href="https://discord.gg/VcdpMh9tTy" target="_blank"><img src="https://img.shields.io/badge/-Join%20community-gray?style=flat-square&logo=discord&logoColor=white&labelColor=5865F2" alt="Join community" /></a> <a href="https://x.com/usemagnitude" target="_blank"><img src="https://img.shields.io/badge/-Follow%20Magnitude-000000?style=flat-square&labelColor=000000&color=gray&logo=x&logoColor=white" alt="Follow Magnitude" /></a>
</p>

<p align="center">
  <strong>Opinionated coding agent for open models</strong>
</p>

Magnitude is the best way to code with open models. We continuously test and optimize so you don't have to.

- **Multi-model** - GLM, Kimi, MiniMax, DeepSeek all used for the right job.
- **Verified providers** - Only the ones serving the models correctly and fast.
- **Purpose-built** — Agent harness built from scratch around open models.
- **Sustainable** - Pass-through API pricing with no markup. $5 free credits.

<p align="center">
  <img src="interface.png" alt="Magnitude interface" width="100%" />
</p>

## Get started

1. Run `npm i -g @magnitudedev/cli` in the terminal
2. Run `magnitude` which will ask for an API key
3. Sign up at [app.magnitude.dev](https://app.magnitude.dev) to get your free API key

> If you are on Windows, you will need to use `wsl`.

$5 of free credits to start, no card required. Pass-through API pricing with no markup after that.

Want to chat about your use case for open models? [Book a call with our founder](https://calendly.com/tom-magnitude/30min)

## Specialized agents

Magnitude is a curated system of specialized agents, each with its own defined role. These agents are made up of a system prompt, specific context, scoped toolsets, and a dedicated model + reasoning level. Here's the agents we include:

- **Leader.** Talks to the user and delegates work. **Model:** GLM 5.1.
- **Scout.** Fast and efficient exploration. **Model:** MiniMax M2.7.
- **Architect.** Plans and high-level design thinking. **Model:** GLM 5.1.
- **Engineer.** Concrete planning and implementation. **Model:** Kimi K2.6.
- **Critic.** Critical and detail-oriented analysis. **Model:** GLM 5.1.
- **Scientist.** Empirical debugging and information gathering. **Model:** GLM 5.1.
- **Artisan.** Tasteful and creative work. **Model:** Kimi K2.6.
- **Advisor.** Smart peer of the leader, always available. **Model:** GLM 5.1.

We test these constantly. New models drop, the lineup updates.

## Why we built this

Open models are now good enough for serious coding. But it's the wild west. You need to choose a harness, then a model, then a provider. And hope they all play nicely together. Often they don't, and you get broken tool calls or subpar performance.

Magnitude bundles the harness, models, and provider into one stack that we continuously test and optimize. We benchmark model combinations to find the best setups, tune our harness to each model's quirks, and route only to providers serving them correctly and fast. 

We know this isn't for everyone. Some people want the flexibility. Some people want to hack together their own setups. And we respect that. But we want to offer a path to using open models that just works. One that will stay on the frontier, without you having to do a thing.

## Acknowledgments

Built on top of [BAML](https://boundaryml.com), [Effect](https://effect.website), and [OpenTUI](https://github.com/anomalyco/opentui).

Inspired by other open source coding agents, including [OpenCode](https://github.com/anomalyco/opencode) and [Codex](https://github.com/openai/codex).
