import type {
  ProjectId,
  TrelloBoardConfiguration,
  TrelloId,
  TrelloListFilterMode,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ClipboardIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TrelloIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readLocalApi } from "../../localApi";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { trelloEnvironment } from "../../state/trello";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

function resultError(result: { readonly _tag: string; readonly cause?: Cause.Cause<unknown> }) {
  if (result._tag !== "Failure" || result.cause === undefined) return null;
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim() ? error.message : "The request failed.";
}

function SecretField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(props.value);
    toastManager.add({ type: "success", title: `${props.label} copied` });
  };
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{props.label}</label>
      <div className="flex items-center gap-1.5">
        <Input
          nativeInput
          type={visible ? "text" : "password"}
          autoComplete="off"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          aria-label={props.label}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                onClick={() => setVisible((current) => !current)}
                aria-label={`${visible ? "Hide" : "Show"} ${props.label}`}
              />
            }
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </TooltipTrigger>
          <TooltipPopup>{visible ? "Hide" : "Show"}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                disabled={!props.value}
                onClick={() => void copy()}
                aria-label={`Copy ${props.label}`}
              />
            }
          >
            <ClipboardIcon />
          </TooltipTrigger>
          <TooltipPopup>Copy</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

interface BoardDialogState {
  readonly original: TrelloBoardConfiguration | null;
}

function TrelloBoardDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
  readonly configuredBoards: ReadonlyArray<TrelloBoardConfiguration>;
  readonly projects: ReturnType<typeof useProjects>;
  readonly state: BoardDialogState;
  readonly onSaved: () => void;
}) {
  const boardsQueryAtom = trelloEnvironment.boards({
    environmentId: props.environmentId,
    input: {},
  });
  const boardsQuery = useEnvironmentQuery(boardsQueryAtom);
  const initial = props.state.original;
  const [boardId, setBoardId] = useState<TrelloId | null>(initial?.boardId ?? null);
  const [projectId, setProjectId] = useState<ProjectId | null>(initial?.projectId ?? null);
  const [filterMode, setFilterMode] = useState<TrelloListFilterMode>(
    initial?.listFilterMode ?? "blacklist",
  );
  const [selectedListIds, setSelectedListIds] = useState<ReadonlySet<TrelloId>>(
    () => new Set(initial?.listIds ?? []),
  );
  const [saving, setSaving] = useState(false);
  const saveBoard = useAtomCommand(trelloEnvironment.upsertBoard, { reportFailure: false });
  const listsQueryAtom = boardId
    ? trelloEnvironment.boardLists({
        environmentId: props.environmentId,
        input: { boardId },
      })
    : null;
  const listsQuery = useEnvironmentQuery(listsQueryAtom);

  useEffect(() => {
    if (!props.open) return;
    setBoardId(initial?.boardId ?? null);
    setProjectId(initial?.projectId ?? null);
    setFilterMode(initial?.listFilterMode ?? "blacklist");
    setSelectedListIds(new Set(initial?.listIds ?? []));
  }, [initial, props.open]);

  const unavailableBoardIds = useMemo(
    () =>
      new Set(
        props.configuredBoards
          .filter((configuration) => configuration.boardId !== initial?.boardId)
          .map((configuration) => configuration.boardId),
      ),
    [initial?.boardId, props.configuredBoards],
  );
  const boards = (boardsQuery.data ?? []).filter((board) => !unavailableBoardIds.has(board.id));
  const selectedBoard = boards.find((board) => board.id === boardId) ?? null;
  const selectedProject = props.projects.find((project) => project.id === projectId) ?? null;

  const toggleList = (listId: TrelloId, checked: boolean) => {
    setSelectedListIds((current) => {
      const next = new Set(current);
      if (checked) next.add(listId);
      else next.delete(listId);
      return next;
    });
  };

  const save = async () => {
    if (!boardId || !projectId) return;
    setSaving(true);
    try {
      const result = await saveBoard({
        environmentId: props.environmentId,
        input: {
          boardId,
          projectId,
          listFilterMode: filterMode,
          listIds: [...selectedListIds],
          ...(initial ? { originalBoardId: initial.boardId } : {}),
        },
      });
      if (AsyncResult.isSuccess(result)) {
        toastManager.add({ type: "success", title: "Trello board saved" });
        props.onSaved();
        props.onOpenChange(false);
        return;
      }
      toastManager.add({
        type: "error",
        title: "Failed to save Trello board",
        description: resultError(result) ?? undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Trello board" : "Add Trello board"}</DialogTitle>
          <DialogDescription>
            Associate one live Trello board with one T3 project and choose which lists are read.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Board</label>
            <div className="flex gap-1.5">
              <Select
                value={boardId}
                onValueChange={(value) => {
                  setBoardId(value as TrelloId | null);
                  setSelectedListIds(new Set());
                }}
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label="Trello board">
                  <SelectValue>{selectedBoard?.name ?? "Select a board"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id} disabled={board.closed}>
                      {board.name}
                      {board.closed ? " (closed)" : ""}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                disabled={!boardId}
                onClick={() => {
                  if (!boardId) return;
                  void navigator.clipboard.writeText(boardId);
                  toastManager.add({ type: "success", title: "Board ID copied" });
                }}
                aria-label="Copy Trello board ID"
              >
                <ClipboardIcon />
              </Button>
            </div>
            {boardsQuery.error ? (
              <p className="text-xs text-destructive">{boardsQuery.error}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">T3 project</label>
            <Select
              value={projectId}
              onValueChange={(value) => setProjectId(value as ProjectId | null)}
            >
              <SelectTrigger aria-label="T3 project">
                <SelectValue>{selectedProject?.title ?? "Select a project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">List filter</label>
            <Select
              value={filterMode}
              onValueChange={(value) => value && setFilterMode(value as TrelloListFilterMode)}
            >
              <SelectTrigger aria-label="Trello list filter mode">
                <SelectValue>
                  {filterMode === "whitelist" ? "Only selected lists" : "All except selected lists"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="whitelist">Only selected lists</SelectItem>
                <SelectItem value="blacklist">All except selected lists</SelectItem>
              </SelectPopup>
            </Select>
            <p className="text-xs text-muted-foreground">
              {filterMode === "whitelist"
                ? "Cards are shown only from the lists checked below."
                : "Cards are shown from every list except those checked below."}
            </p>
          </div>

          {boardId ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Lists</div>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-2">
                {(listsQuery.data ?? []).map((list) => (
                  <label
                    key={list.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={selectedListIds.has(list.id)}
                      onCheckedChange={(checked) => toggleList(list.id, checked === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{list.name}</span>
                    {list.closed ? (
                      <span className="text-xs text-muted-foreground">Closed</span>
                    ) : null}
                  </label>
                ))}
                {listsQuery.isPending ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">Loading lists…</p>
                ) : null}
                {listsQuery.error ? (
                  <p className="px-2 py-3 text-xs text-destructive">{listsQuery.error}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!boardId || !projectId || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save board"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function TrelloSettingsSection() {
  const environmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const settingsAtom = environmentId
    ? trelloEnvironment.settings({ environmentId, input: {} })
    : null;
  const settings = useEnvironmentQuery(settingsAtom);
  const boardsAtom = environmentId ? trelloEnvironment.boards({ environmentId, input: {} }) : null;
  const boards = useEnvironmentQuery(settings.data?.credentials ? boardsAtom : null);
  const saveCredentials = useAtomCommand(trelloEnvironment.saveCredentials, {
    reportFailure: false,
  });
  const clearCredentials = useAtomCommand(trelloEnvironment.clearCredentials, {
    reportFailure: false,
  });
  const deleteBoard = useAtomCommand(trelloEnvironment.deleteBoard, { reportFailure: false });
  const [apiKey, setApiKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [dialogState, setDialogState] = useState<BoardDialogState | null>(null);

  useEffect(() => {
    if (!settings.data?.credentials) return;
    setApiKey(settings.data.credentials.apiKey);
    setApiToken(settings.data.credentials.apiToken);
  }, [settings.data?.credentials]);

  const refresh = () => {
    if (settingsAtom) appAtomRegistry.refresh(settingsAtom);
    if (boardsAtom) appAtomRegistry.refresh(boardsAtom);
  };

  const saveCredentialFields = async () => {
    if (!environmentId || !apiKey.trim() || !apiToken.trim()) return;
    setSavingCredentials(true);
    try {
      const result = await saveCredentials({
        environmentId,
        input: { apiKey: apiKey.trim(), apiToken: apiToken.trim() },
      });
      if (AsyncResult.isSuccess(result)) {
        toastManager.add({ type: "success", title: "Trello credentials saved" });
        refresh();
      } else {
        toastManager.add({
          type: "error",
          title: "Trello credentials were rejected",
          description: resultError(result) ?? undefined,
        });
      }
    } finally {
      setSavingCredentials(false);
    }
  };

  const removeBoard = async (configuration: TrelloBoardConfiguration) => {
    if (!environmentId) return;
    const confirmed = await readLocalApi()?.dialogs.confirm(
      "Remove this Trello board from T3 Code? Existing card-to-chat links will be kept.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const result = await deleteBoard({
      environmentId,
      input: { boardId: configuration.boardId },
    });
    if (AsyncResult.isSuccess(result)) {
      toastManager.add({ type: "success", title: "Trello board removed" });
      refresh();
    } else {
      toastManager.add({
        type: "error",
        title: "Failed to remove Trello board",
        description: resultError(result) ?? undefined,
      });
    }
  };

  const clearCredentialFields = async () => {
    if (!environmentId) return;
    const confirmed = await readLocalApi()?.dialogs.confirm(
      "Clear the saved Trello API key and token? Board configuration will be kept, but Trello views will stop working until credentials are saved again.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const result = await clearCredentials({ environmentId, input: {} });
    if (AsyncResult.isSuccess(result)) {
      setApiKey("");
      setApiToken("");
      toastManager.add({ type: "success", title: "Trello credentials cleared" });
      refresh();
    } else {
      toastManager.add({ type: "error", title: "Failed to clear Trello credentials" });
    }
  };

  const boardNameById = new Map(
    (boards.data ?? []).map((board) => [board.id, board.name] as const),
  );
  const projectNameById = new Map(projects.map((project) => [project.id, project.title] as const));
  const configuredBoards = settings.data?.boards ?? [];

  return (
    <SettingsSection
      id="trello"
      title="Trello"
      icon={<TrelloIcon className="size-5 text-[#0c66e4]" />}
      headerAction={
        settings.data?.credentials ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => setDialogState({ original: null })}
            aria-label="Add Trello board"
          >
            <PlusIcon />
          </Button>
        ) : null
      }
    >
      <SettingsRow
        title="API credentials"
        description="Required for reading boards, lists, cards, comments, and attachments. The token stays on this T3 server."
      >
        <div className="grid gap-3 py-3 sm:grid-cols-2">
          <SecretField label="Trello API key" value={apiKey} onChange={setApiKey} />
          <SecretField label="Trello API token" value={apiToken} onChange={setApiToken} />
        </div>
        <div className="flex justify-end gap-2 pb-3">
          {settings.data?.credentials ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void clearCredentialFields()}
            >
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!environmentId || !apiKey.trim() || !apiToken.trim() || savingCredentials}
            onClick={() => void saveCredentialFields()}
          >
            {savingCredentials ? "Validating…" : "Save credentials"}
          </Button>
        </div>
        {settings.error ? <p className="pb-3 text-xs text-destructive">{settings.error}</p> : null}
      </SettingsRow>

      <SettingsRow
        title="Boards"
        description="Each board belongs to one T3 project. Board and list names are fetched live from Trello."
      >
        <div className="space-y-1 py-2">
          {configuredBoards.map((configuration) => (
            <div
              key={configuration.boardId}
              className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
            >
              <TrelloIcon className="size-4 shrink-0 text-[#0c66e4]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {boardNameById.get(configuration.boardId) ?? configuration.boardId}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {projectNameById.get(configuration.projectId) ?? configuration.projectId} ·{" "}
                  {configuration.listFilterMode === "whitelist" ? "Only" : "Except"}{" "}
                  {configuration.listIds.length} selected{" "}
                  {configuration.listIds.length === 1 ? "list" : "lists"}
                </div>
              </div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => setDialogState({ original: configuration })}
                aria-label="Edit Trello board"
              >
                <PencilIcon />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => void removeBoard(configuration)}
                aria-label="Remove Trello board"
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          {settings.data?.credentials && configuredBoards.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No Trello boards configured.
            </div>
          ) : null}
          {!settings.data?.credentials ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              Save valid credentials before adding a board.
            </div>
          ) : null}
        </div>
      </SettingsRow>

      {environmentId && dialogState ? (
        <TrelloBoardDialog
          key={dialogState.original?.boardId ?? "new"}
          open
          onOpenChange={(open) => !open && setDialogState(null)}
          environmentId={environmentId}
          configuredBoards={configuredBoards}
          projects={projects}
          state={dialogState}
          onSaved={refresh}
        />
      ) : null}
    </SettingsSection>
  );
}
