import type { ComponentProps } from "react";
import { PromptBar } from "../ui/PromptBar";
export function ChatInput(props: ComponentProps<typeof PromptBar>) { return <PromptBar {...props} />; }
