# T-003_files - dev_result

Summary:
- Created `files.md` at project root listing `hello.txt` then `world.txt` on separate lines.
- Verified `hello.txt` and `world.txt` remain present and correct.

Files:
- Added `files.md`.
- Added `data/tasks/T-003_files/dev_ack.json`.
- Added `data/tasks/T-003_files/dev_result.md`.

Tests:
- `Get-Content files.md` -> lines `hello.txt`, `world.txt`
- `Format-Hex files.md` -> bytes `68 65 6C 6C 6F 2E 74 78 74 0D 0A 77 6F 72 6C 64 2E 74 78 74 0D 0A`
- `Get-Content hello.txt` -> `hello`
- `Format-Hex hello.txt` -> bytes `68 65 6C 6C 6F 0D 0A`
- `Get-Content world.txt` -> `world`
- `Format-Hex world.txt` -> bytes `77 6F 72 6C 64 0D 0A`

Questions:
- None.

Ecarts & rationale:
- None.
