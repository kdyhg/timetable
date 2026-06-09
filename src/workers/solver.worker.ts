import { accept, applyMove, createRuntime, diagnostics, moveOptions, progress, repairApply, repairOptions, repairPreview, runChunk, simulateMoveTransaction, stop } from "@/solver/core";
import type { Candidate, NormalizedRecords, SolveOptions, WorkerRequest, WorkerResponse } from "@/solver/types";

let runtime: ReturnType<typeof createRuntime> | null = null;
let accepted: Candidate | null = null;

function send(message: WorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      runtime = createRuntime(message.records as NormalizedRecords, message.solveOptions as SolveOptions);
      accepted = message.candidate || null;
      if (accepted) runtime.best = accepted;
      send({ type: "ready" });
      return;
    }
    if (!runtime) {
      send({ type: "error", message: "브라우저 배정 엔진이 초기화되지 않았습니다." });
      return;
    }
    if (message.type === "reassign") {
      runtime = createRuntime(runtime.records, message.solveOptions);
      accepted = message.candidate || accepted;
      if (accepted) runtime.best = accepted;
      send({ type: "ready" });
      return;
    }
    if (message.type === "start" || message.type === "continue") {
      const result = runChunk(runtime);
      if (!result || !("candidate" in result) || !result.candidate) return;
      const currentProgress = progress(runtime, result.changed);
      if (result.changed) {
        send({ type: "bestChanged", candidate: result.candidate, progress: currentProgress, diagnostics: diagnostics(runtime.records, result.candidate) });
      }
      send({ type: "progress", progress: currentProgress });
      return;
    }
    if (message.type === "acceptBest") {
      accepted = accept(runtime);
      if (!accepted) {
        send({ type: "error", message: "확정할 현재 최선안이 없습니다." });
        return;
      }
      send({ type: "accepted", candidate: accepted, diagnostics: diagnostics(runtime.records, accepted) });
      return;
    }
    if (message.type === "stop") {
      stop(runtime);
      send({ type: "progress", progress: progress(runtime, false) });
      send({ type: "stopped" });
      return;
    }
    if (message.type === "moveOptions") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "수동수정할 시간표가 없습니다." });
        return;
      }
      send({ type: "moveOptions", options: moveOptions(runtime.records, base, message.from, runtime.options) });
      return;
    }
    if (message.type === "movePreview") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "수동수정할 시간표가 없습니다." });
        return;
      }
      send({ type: "movePreview", preview: simulateMoveTransaction(runtime.records, base, message.move, runtime.options).preview });
      return;
    }
    if (message.type === "moveApply") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "수동수정할 시간표가 없습니다." });
        return;
      }
      accepted = applyMove(runtime.records, base, message.move, runtime.options);
      runtime.best = accepted;
      send({ type: "moveApplied", candidate: accepted, diagnostics: diagnostics(runtime.records, accepted) });
      return;
    }
    if (message.type === "repairOptions") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "AI 보정을 위한 시간표가 없습니다." });
        return;
      }
      send({ type: "repairOptions", proposals: repairOptions(runtime.records, base, runtime.options) });
      return;
    }
    if (message.type === "repairPreview") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "AI 보정을 위한 시간표가 없습니다." });
        return;
      }
      send({ type: "repairPreview", preview: repairPreview(base, message.proposal) });
      return;
    }
    if (message.type === "repairApply") {
      const base = accepted || runtime.best;
      if (!base) {
        send({ type: "error", message: "AI 보정을 위한 시간표가 없습니다." });
        return;
      }
      accepted = repairApply(runtime.records, base, message.proposal, runtime.options);
      runtime.best = accepted;
      send({ type: "repairApplied", candidate: accepted, diagnostics: diagnostics(runtime.records, accepted) });
      return;
    }
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "브라우저 배정 엔진 오류가 발생했습니다." });
  }
};

export {};
