import { resolve } from "node:path";

// Use the real TopBar, brand, window controls and build popover. Only replace
// app routing/IPC and unrelated actions so this fixture never touches a session.
export function topBarPreviewMocks(desktop) {
	const mocks = new Map();
	const hooks = {
		"renderer/lib/session-names": "export const renameSessionTab=async()=>{};",
		"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider":
			'export const useWorkspace=()=>({workspace:{id:"preview"}});',
		"renderer/hooks/host-service/useV2NotificationStatus":
			"export const useV2SourcesNotificationStatus=()=>null;",
		"renderer/stores/v2-notifications":
			"export const getV2NotificationSourcesForTab=()=>[];",
		"renderer/components/StatusIndicator":
			'export const getStatusTooltip=()=>"Working";',
		"@tanstack/react-router":
			'export const useMatchRoute=()=>()=>({workspaceId:"preview"}); export const useParams=()=>({workspaceId:"preview"});',
		"renderer/hooks/useIsV2CloudEnabled":
			"export const useIsV2CloudEnabled=()=>true;",
		"renderer/hooks/useOnlineStatus": "export const useOnlineStatus=()=>true;",
		"renderer/hooks/useSkinTokens":
			'export const useSkinTokens=()=>({accountPlacement:"sidebar",shellChrome:"topbar",topBarSurface:"floating"});',
		"renderer/hooks/useZoomFactor": "export const useZoomFactor=()=>1;",
		"renderer/commandPalette/ui/QuickOpen/quickOpenStore":
			"export const useQuickOpenStore=select=>select({openFor:()=>{}});",
		"renderer/stores/workspace-sidebar-state":
			"export const useWorkspaceSidebarStore=select=>select({isOpen:true,isCollapsed:()=>false});",
		"renderer/lib/electron-trpc": `const branch=(path=[])=>new Proxy(()=>{}, {get:(_,key)=>key==='useQuery'?()=>({data:path.join('.')==='window.getPlatform'?'win32':path.join('.')==='diagnostics.appVersion'?{version:'1.18.32',isDev:false}:undefined}):key==='useMutation'?()=>({mutate:()=>{}}):branch([...path,key])}); export const electronTrpc=branch();`,
	};
	return {
		name: "topbar-preview-mocks",
		enforce: "pre",
		resolveId(source, importer = "") {
			if (source === "react" && importer.startsWith("\0topbar-preview:"))
				return this.resolve(
					source,
					resolve(desktop, "scripts/build-status/renderer.tsx"),
					{ skipSelf: true },
				);
			const normalized = source
				.replaceAll("\\", "/")
				.replace(
					`${resolve(desktop, "src/renderer").replaceAll("\\", "/")}/`,
					"renderer/",
				);
			let code = hooks[normalized];
			if (importer.replaceAll("\\", "/").endsWith("/TopBar/TopBar.tsx")) {
				const name = source.split("/").at(-1);
				if (
					[
						"NavigationControls",
						"OpenInMenuButton",
						"OrganizationDropdown",
						"ResourceConsumption",
						"V2WorkspaceOpenInButton",
						"V2WorkspaceTitle",
					].includes(name)
				)
					code = `export const ${name}=()=>null;`;
				if (name === "SidebarToggle")
					code = `import {createElement as h} from 'react'; export const SidebarToggle=()=>h('button',{type:'button','aria-label':'Toggle sidebar',className:'size-10 shrink-0'},'◫');`;
				if (name === "UpdateButton")
					code = `import {createElement as h} from 'react'; export const UpdateButton=()=>h('button',{type:'button','aria-label':'Update',className:'size-9 shrink-0'},'↓');`;
				if (name === "BuildStatus")
					code = `import {createElement as h,useEffect,useState} from 'react'; import {BuildStatusView} from ${JSON.stringify(resolve(desktop, "src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/BuildStatus/BuildStatus.tsx"))}; export function BuildStatus(){const [jobs,setJobs]=useState([]);useEffect(()=>{const update=e=>setJobs(e.detail);window.addEventListener('preview-builds',update);return()=>window.removeEventListener('preview-builds',update)},[]);return h(BuildStatusView,{jobs,onDismiss:job=>window.dispatchEvent(new CustomEvent('preview-dismiss',{detail:job.id})),onOpen:url=>window.dispatchEvent(new CustomEvent('preview-open',{detail:url}))})}`;
			}
			if (!code) return;
			const id = `\0topbar-preview:${source}`;
			mocks.set(id, code);
			return id;
		},
		load(id) {
			return mocks.get(id);
		},
	};
}
