# Joey Library

## The code is public: keep private details out of git

The Joey Library repository is public on GitHub. Anything committed can be read by anyone, and stays in the
history even after it is deleted. So nothing about the network, logins or connections goes into a tracked file:

- host names, IP addresses, Tailscale names or tailnet addresses, ports opened for remote access, URLs of the
  running app
- user names, passwords, API keys, tokens, cookies, session ids
- connection settings, proxy or serve configuration, firewall rules, VPN details

If such information has to be written to a file (a note, a start script, a config, a log, a screenshot that shows
it), put it in a file that git ignores:

- use the `local/` folder or a name with `.local.` in it (`start.local.ps1`, `CLAUDE.local.md`); both are in
  `.gitignore`. Anything else, add to `.gitignore` before creating the file.
- check with `git status` or `git check-ignore -v <file>` that git does not see it.
- before every commit, look through the staged diff (`git diff --cached`) for any of the above, and leave it out
  if it is there.

Code may read such settings from the environment or from an ignored file. The tracked code only holds the names
of the settings and safe defaults such as `127.0.0.1`.
