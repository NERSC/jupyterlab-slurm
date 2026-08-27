(architecture)=

# Architecture

This page gives an overview of how `jupyterlab-slurm` is put together, for
developers who want to extend or debug the extension. It complements
{ref}`api` (REST endpoint reference) and {ref}`development` (build/install
instructions) with two diagrams: the frontend (UI) component tree, and the
backend (Jupyter Server) request-handling pipeline.

## UI components

The frontend is a standard JupyterLab plugin (`src/index.ts`) that
registers commands/launcher entries and lazily instantiates two top-level
widgets: the main `SlurmWidget` (queue + history) and a separate
`SlurmJobDetailsWidget` (opened per-job via the `COMMAND_ID_SHOW_DETAILS`
command). Data fetching is centralized in `handler.ts` (`requestAPI`) and
wrapped by small hooks (`useSlurmQueue`, `useSlurmHistory`,
`useJobDetails`) that the presentational components consume.

```mermaid
graph TD
    subgraph Plugin["src/index.ts (JupyterLab plugin)"]
        Commands["Commands / Launcher / Palette\n(show-details, open-manager, ...)"]
    end

    Commands -->|instantiates| SlurmWidget["SlurmWidget\n(slurmWidget.tsx)"]
    Commands -->|instantiates, lazy import| SlurmJobDetailsWidget["SlurmJobDetailsWidget\n(slurmJobDetailsWidget.tsx)"]

    SlurmWidget --> SlurmManager["SlurmManager.tsx\n(tab container, user fetch)"]
    SlurmJobDetailsWidget --> JobDetailsPanel["JobDetailsPanel.tsx"]

    SlurmManager --> ThemeProvider["JupyterThemeProvider.tsx"]
    SlurmManager --> SqueueDataTable["SqueueDataTable.tsx\n(Queue tab, ag-grid)"]
    SlurmManager --> SlurmJobHistory["SlurmJobHistory.tsx\n(History tab, ag-grid)"]

    SqueueDataTable --> SqueueToolbar["SqueueToolbar.tsx\n(filters, submit, actions)"]
    SqueueDataTable -->|column defs| ColumnDefs["utils/slurm-column-defs.ts"]
    SqueueDataTable -->|emits command| Commands

    JobDetailsPanel --> JobField["JobField.tsx\n(labeled field display)"]

    SqueueDataTable -.->|useSlurmQueue| Hooks
    SlurmJobHistory -.->|useSlurmHistory| Hooks
    JobDetailsPanel -.->|useJobDetails| Hooks

    subgraph Hooks["src/hooks"]
        useSlurmQueue["useSlurmQueue.ts"]
        useSlurmHistory["useSlurmHistory.ts"]
        useJobDetails["useJobDetails.ts"]
    end

    useSlurmQueue --> RequestAPI["handler.ts\nrequestAPI()"]
    useSlurmHistory --> RequestAPI
    useJobDetails --> RequestAPI
    SlurmManager -->|user, settings| RequestAPI

    RequestAPI -->|"HTTP fetch\n/jupyterlab_slurm/*"| Server["Jupyter Server\n(backend, see below)"]
```

Key points:

- `handler.ts` is the single choke point for all HTTP calls to the server
  extension, including unified error handling (`SlurmApiError`).
- The three `hooks/*` modules own polling/loading/error state for their
  respective data sources, keeping the presentational components
  (`SqueueDataTable`, `SlurmJobHistory`, `JobDetailsPanel`) focused on
  rendering.
- `SqueueDataTable` and `JobDetailsPanel` communicate via JupyterLab
  commands (e.g. `COMMAND_ID_SHOW_DETAILS`) rather than direct references,
  since they can live in separate widgets/tabs.

## Backend components

The server extension (`jupyterlab_slurm/`) registers a set of Tornado
`APIHandler`s under `/jupyterlab_slurm/*`. Each Slurm-command handler
extends the shared `SlurmCommandHandler` base class, builds a command line,
runs it (optionally through site hooks), and returns a unified JSON
envelope built by `_common.make_envelope`. Deployment-level behavior is
supplied by Traitlets `Configurable`s, loaded from the Jupyter Server
config file.

```mermaid
graph TD
    Client["Frontend\n(handler.ts requestAPI)"]

    Client -->|GET /status| HealthCheckHandler
    Client -->|GET /user| UserFetchHandler
    Client -->|GET /ui-config| UiConfigHandler
    Client -->|GET /squeue| SqueueHandler
    Client -->|DELETE /scancel| ScancelHandler
    Client -->|GET/POST /scontrol/&lt;action&gt;| ScontrolHandler
    Client -->|POST /sbatch| SbatchHandler
    Client -->|GET /sacct| SacctHandler
    Client -->|GET /job/&lt;job_id&gt;| JobDetailsHandler

    subgraph Handlers["jupyterlab_slurm/handlers.py"]
        HealthCheckHandler
        UserFetchHandler
        UiConfigHandler
        SlurmCommandHandler["SlurmCommandHandler\n(base class)"]
        SqueueHandler --> SlurmCommandHandler
        ScancelHandler --> SlurmCommandHandler
        ScontrolHandler --> SlurmCommandHandler
        SbatchHandler --> SlurmCommandHandler
        SacctHandler --> SlurmCommandHandler
        JobDetailsHandler
    end

    SlurmCommandHandler -->|"pre_build / pre_exec /\naround_exec / post_process / audit"| SiteHooks["Site hooks\n(module.submodule:callable,\nfail-closed allowlist)"]
    SlurmCommandHandler -->|subprocess exec| SlurmCLI["Slurm CLI\nsqueue / sbatch / scancel /\nscontrol / sacct"]
    JobDetailsHandler -->|reuses| SqueueHandler
    JobDetailsHandler -->|reuses| SacctHandler

    HealthCheckHandler --> Envelope["_common.make_envelope()\n(unified success/data/error JSON)"]
    UserFetchHandler --> Envelope
    UiConfigHandler --> Envelope
    SlurmCommandHandler --> Envelope

    subgraph Config["jupyterlab_slurm/config.py (Traitlets Configurable)"]
        SlurmCommandPaths["SlurmCommandPaths\n(binary paths)"]
        SlurmAccounting["SlurmAccounting\n(sacct window/fields)"]
        SlurmUI["SlurmUI\n(column labels/sizing,\npoll floor, site hooks)"]
    end

    SlurmCommandPaths -.->|configures| SlurmCLI
    SlurmAccounting -.->|configures| SacctHandler
    SlurmUI -.->|configures| UiConfigHandler
    SlurmUI -.->|configures| SiteHooks

    ServerConfig["jupyter_server_config.py"] --> Config
```

Key points:

- All handlers respond with the same envelope shape
  (`{success, data, errorMessage, exitCode, responseMessage}`), which is
  what `handler.ts`/`SlurmApiError` on the frontend expect.
- `JobDetailsHandler` composes data from `squeue`/`sacct` rather than
  calling a dedicated Slurm command, to build a consolidated per-job view.
- Site hooks are opt-in and fail-closed: they only run if explicitly
  listed in `SlurmUI.site_hook_allowlist`, see {ref}`configuration` for
  details.
