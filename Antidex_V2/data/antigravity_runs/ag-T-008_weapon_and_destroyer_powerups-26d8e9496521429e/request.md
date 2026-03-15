Antidex task (you are Antigravity / developer_antigravity).
project_cwd: C:\Users\kdeplus\OneDrive - Université Libre de Bruxelles\Bureau\code\Games\arcano-d
task_id: T-008_weapon_and_destroyer_powerups

READ FIRST:
- agents/AG_cursorrules.md
- agents/developer_antigravity.md
- data/tasks/T-008_weapon_and_destroyer_powerups/task.md
- data/tasks/T-008_weapon_and_destroyer_powerups/manager_instruction.md

WRITE (MUST):
1) ACK immediately: data/antigravity_runs/ag-T-008_weapon_and_destroyer_powerups-26d8e9496521429e/ack.json
2) RESULT atomically: write data/antigravity_runs/ag-T-008_weapon_and_destroyer_powerups-26d8e9496521429e/result.tmp then rename -> data/antigravity_runs/ag-T-008_weapon_and_destroyer_powerups-26d8e9496521429e/result.json
3) Pointer (required): data/tasks/T-008_weapon_and_destroyer_powerups/dev_result.json (schema in your instructions)
4) Update data/pipeline_state.json with developer_status="ready_for_review" + summary pointing to data/tasks/T-008_weapon_and_destroyer_powerups/dev_result.json
5) Heartbeat progress: data/AG_internal_reports/heartbeat.json
6) Finally turn marker: write data/turn_markers/turn-c52cf9b43cfc48df85ef.tmp then rename -> data/turn_markers/turn-c52cf9b43cfc48df85ef.done with content 'ok'

Note: artifacts directory is data/antigravity_runs/ag-T-008_weapon_and_destroyer_powerups-26d8e9496521429e/artifacts (screenshots optional but recommended).
Also write the full task request to: data/antigravity_runs/ag-T-008_weapon_and_destroyer_powerups-26d8e9496521429e/request.md
@[TerminalName: powershell, ProcessId: 33932] 
@[TerminalName: powershell, ProcessId: 33932] 
