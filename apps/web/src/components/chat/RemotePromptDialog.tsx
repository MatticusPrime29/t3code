import type {
  EnvironmentId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { truncate } from "@t3tools/shared/String";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { newMessageId, newThreadId } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { useProjects, useServerConfigs } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { waitForStartedServerThread } from "../ChatView.logic";
import {
  buildRemotePromptModelOptions,
  remotePromptModelKey,
  resolveRemotePromptModelSelection,
} from "./RemotePromptDialog.logic";

interface RemotePromptDialogProps {
  readonly open: boolean;
  readonly prompt: string;
  readonly sourceEnvironmentId: EnvironmentId;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly onOpenChange: (open: boolean) => void;
}

export function RemotePromptDialog(props: RemotePromptDialogProps) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
  const [isSending, setIsSending] = useState(false);

  const destinations = useMemo(
    () =>
      environments.filter(
        (environment) =>
          environment.environmentId !== props.sourceEnvironmentId &&
          serverConfigs.has(environment.environmentId),
      ),
    [environments, props.sourceEnvironmentId, serverConfigs],
  );
  const targetProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const targetProject = targetProjects.find((project) => project.id === projectId) ?? null;
  const modelOptions = useMemo(
    () => buildRemotePromptModelOptions(serverConfigs.get(environmentId!)?.providers ?? []),
    [environmentId, serverConfigs],
  );

  useEffect(() => {
    if (!props.open) return;
    const nextEnvironmentId = destinations[0]?.environmentId ?? null;
    const nextProject = projects.find((project) => project.environmentId === nextEnvironmentId);
    const nextOptions = buildRemotePromptModelOptions(
      nextEnvironmentId ? (serverConfigs.get(nextEnvironmentId)?.providers ?? []) : [],
    );
    setEnvironmentId(nextEnvironmentId);
    setProjectId(nextProject?.id ?? null);
    setModelSelection(
      resolveRemotePromptModelSelection(nextOptions, nextProject?.defaultModelSelection),
    );
    setIsSending(false);
  }, [destinations, projects, props.open, serverConfigs]);

  const chooseEnvironment = (value: unknown) => {
    const nextEnvironment = destinations.find(
      (environment) => environment.environmentId === String(value),
    );
    if (!nextEnvironment) return;
    const nextProject = projects.find(
      (project) => project.environmentId === nextEnvironment.environmentId,
    );
    const nextOptions = buildRemotePromptModelOptions(
      serverConfigs.get(nextEnvironment.environmentId)?.providers ?? [],
    );
    setEnvironmentId(nextEnvironment.environmentId);
    setProjectId(nextProject?.id ?? null);
    setModelSelection(
      resolveRemotePromptModelSelection(nextOptions, nextProject?.defaultModelSelection),
    );
  };

  const chooseProject = (value: unknown) => {
    const nextProject = targetProjects.find((project) => project.id === String(value));
    if (!nextProject) return;
    setProjectId(nextProject.id);
    setModelSelection(
      resolveRemotePromptModelSelection(modelOptions, nextProject.defaultModelSelection),
    );
  };

  const chooseModel = (value: unknown) => {
    const option = modelOptions.find((candidate) => candidate.key === String(value));
    if (option) setModelSelection(option.selection);
  };

  const send = async () => {
    const prompt = props.prompt;
    if (!environmentId || !targetProject || !modelSelection || prompt.trim().length === 0) return;

    setIsSending(true);
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const title = truncate(prompt.trim().split("\n", 1)[0] ?? prompt.trim());
    const createResult = await createThread({
      environmentId,
      input: {
        threadId,
        projectId: targetProject.id,
        title,
        modelSelection,
        runtimeMode: props.runtimeMode,
        interactionMode: props.interactionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });

    if (createResult._tag === "Failure") {
      setIsSending(false);
      toastManager.add({
        type: "error",
        title: "Could not create remote thread",
        description: "The target environment rejected the thread creation request.",
      });
      return;
    }

    const startResult = await startThreadTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: prompt,
          attachments: [],
        },
        modelSelection,
        runtimeMode: props.runtimeMode,
        interactionMode: props.interactionMode,
        titleSeed: title,
        createdAt,
      },
    });

    if (startResult._tag === "Failure") {
      const cleanupResult = await deleteThread({ environmentId, input: { threadId } });
      setIsSending(false);
      toastManager.add({
        type: "error",
        title: "Could not send remote prompt",
        description:
          cleanupResult._tag === "Success"
            ? "The remote thread was cleaned up after its first turn failed to start."
            : "The first turn failed to start, and the empty remote thread could not be removed.",
      });
      return;
    }

    await waitForStartedServerThread(scopeThreadRef(environmentId, threadId));
    props.onOpenChange(false);
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to another environment</DialogTitle>
          <DialogDescription>
            Create a new thread in a connected environment using the current prompt.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connect another environment before sending a prompt remotely.
            </p>
          ) : (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Environment
                <Select value={environmentId ?? undefined} onValueChange={chooseEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {destinations.map((environment) => (
                      <SelectItem key={environment.environmentId} value={environment.environmentId}>
                        {environment.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Project
                <Select value={projectId ?? undefined} onValueChange={chooseProject}>
                  <SelectTrigger disabled={targetProjects.length === 0}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {targetProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Model
                <Select
                  value={modelSelection ? remotePromptModelKey(modelSelection) : undefined}
                  onValueChange={chooseModel}
                >
                  <SelectTrigger disabled={modelOptions.length === 0}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        <span className="flex min-w-0 items-center justify-between gap-4">
                          <span className="truncate">{option.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {option.providerLabel}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              {targetProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">This environment has no projects.</p>
              ) : modelOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This environment has no ready providers with selectable models.
                </p>
              ) : null}
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            disabled={
              isSending || !targetProject || !modelSelection || props.prompt.trim().length === 0
            }
          >
            {isSending ? "Sending..." : "Send prompt"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
