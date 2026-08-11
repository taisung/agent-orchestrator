import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerSpawn, registerBatchSpawn } from "./commands/spawn.js";
import { registerSession } from "./commands/session.js";
import { registerSend } from "./commands/send.js";
import { registerReviewCheck } from "./commands/review-check.js";
import { registerStart, registerStop } from "./commands/start.js";
import { registerLifecycleWorker } from "./commands/lifecycle-worker.js";
import { registerVerify } from "./commands/verify.js";
import { registerDoctor } from "./commands/doctor.js";
import { getConfigInstruction } from "./lib/config-instruction.js";
import { getCliVersion } from "./options/version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ao")
    .description("Agent Orchestrator — manage parallel AI coding agents")
    .version(getCliVersion());

  registerInit(program);
  registerStart(program);
  registerStop(program);
  registerStatus(program);
  registerSpawn(program);
  registerBatchSpawn(program);
  registerSession(program);
  registerSend(program);
  registerReviewCheck(program);
  registerLifecycleWorker(program);
  registerVerify(program);
  registerDoctor(program);

  program
    .command("config-help")
    .description("Show config schema and guide for creating agent-orchestrator.yaml")
    .action(() => {
      console.log(getConfigInstruction());
    });

  return program;
}
