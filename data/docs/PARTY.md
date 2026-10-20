# Playing together (Party, G)

Several people, each with their own Vanilla Agents and Claude helpers, share one world and one plan.

1. **One person hosts:** Party window (G) > Host. Pick **who can join**: *Only this PC* (the hub listens on 127.0.0.1; for trying it out
   or several windows on one PC) or *My network* (friends on your Wi-Fi or VPN), and **how long the link works** (1 h, 8 h, 24 h or 3 days;
   default 24 h, `panels/party.json` `options.invite_hours`). Their PC opens a small party hub on port 8940 and shows an invite link
   (`http://<their-pc>:8940/party?t=...`). Send it to the others. Anyone with the link can join until it runs out, so share it only with them.
   The host sees one link per way in: **Same Wi-Fi**, and **Tailscale** when this PC is on Tailscale (friends anywhere, no port to open).
2. **Everyone else joins:** they click the link. Their browser shows the party's name and a **Join in Vanilla Agents** button, which
   hands the link to their own Vanilla Agents (`http://127.0.0.1:8766/join`); its Party window opens by itself and asks
   "You're invited to ..." with their name filled in: **Join** or **Not now**. Nothing joins without that click.
   Or, as before: Party window > paste the link > Join. You see each other in "In the party", and each other's helpers walk around in your inn.
3. **Agree on a plan:** anyone proposes items (what, why, size). Your Claude can propose too (MCP tool `party_propose`).
   Any change asks everyone again. When every active member has pressed "I agree" on the same version, the plan locks.
4. **Split the work:** the items are shared out by size so everyone gets a similar load. Your items appear in your own quest log as new quests,
   which **you still approve** (nobody in the party can approve for you). Before anyone starts an item, you can Take it from someone else.
5. **Work and watch:** your Claude reads the plan with `party_plan` and works only on items marked ours. As your quests move
   (in progress, handed in, done, failed), everyone sees the status in the plan.

## Community chat (people only)
The Chat window has two tabs along its top: **General** (the log of your helpers) and **Community** (the people in your party).
- Open the Community tab and type, then Enter; or type `/c message` (or `/community message`) from any tab.
- Lines show as `[time] Name: text` in party blue; your own name is highlighted. Joined / left / removed lines appear too.
- A red number on the tab counts new lines while you are on another tab; a soft sound plays (Chat options in `panels/chat.json`:
  `community_sound`, `community_volume_pct`; Mute silences it). Screen readers hear new lines.
- The search box filters the tab you are on. The host can delete a line for everyone (the small cross when you point at it).
- Messages are 1 to 500 characters, at most 5 per person in 10 seconds. The host's hub keeps the last 300; you see the lines from when you joined.
- **Claude never sees this chat**: it does not go into the event feed, the hooks, the MCP tools, whispers or diagnostics (see PRIVACY.md).
  To tell your helpers something use `/w name` or `/p` as before.
- Not in a party? The tab says how to join one (G).

## The host's controls
Only the person who hosts (marked *host* in "In the party") sees these; the hub checks it too, so nobody else can use them.
- **The invite link** with Copy, and how long it still works. **New link** makes a fresh one: the old link stops working,
  people already in the party stay in (they keep their keys).
- **Remove** next to a member (press twice to confirm): their key stops working (their window says the host removed them), their
  unstarted items go back to the plan for anyone to take, and the invite link is renewed so the old link cannot bring them straight back.
  Send the new link to anyone still to join.
- A reminder that the hub is plain HTTP on your network (or, for *Only this PC*, that nobody else can reach it).

The host is the member who joined with the hub's secret host token: the hosting window does this by itself and never shows the token.
A stand-alone hub (below) prints two links: the invite for friends, and your own host link (`...&h=...`) to join with first.

What crosses the network: names, helper names / roles / working or idle / a one-line activity, the plan, statuses, and the community chat.
Never your code, files, window key or approvals.

## Networks
- Same Wi-Fi or office network: works as is (allow Python through the Windows firewall for private networks when asked).
- Over the internet: use a VPN such as Tailscale or ZeroTier and send the link with the host's VPN address, or forward port 8940.
  The hub speaks plain HTTP; the invite token and member keys are the only protection (anyone on the same network who can watch the
  traffic could read them), so do not open it to the whole internet, and use expiring links and Remove when someone should not be there.
- A host without the window: `python -m vanilla_agents.party.hub --name "Raid night" [--bind 127.0.0.1] [--hours 24]` (prints the invite
  link and your host link; everyone joins from their window).

Leaving gives your unstarted items back to the plan. If the host closes their window the party pauses; it comes back with the same
link when they start Vanilla Agents again.
