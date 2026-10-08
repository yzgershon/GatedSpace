import { createRoot } from "react-dom/client";
import { SidebarPreview } from "./SidebarPreview/SidebarPreview";
import "./style.css";

const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(<SidebarPreview />);
