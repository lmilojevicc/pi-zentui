/** Explicit Zentui template names; host segment IDs are not template aliases. */
export const HOST_TEMPLATE_VARIABLES = [
	"session_id",
	"pr_number",
	"pr_url",
	"ci",
	"subagent_count",
	"token_rate",
	"active_time",
	"hostname",
	"usage_quota",
	"collaboration",
	"stream_state",
	"vim_mode",
	"plan_mode",
	"prewalk_mode",
	"goal_mode",
	"vibe_mode",
	"loop_mode",
] as const;

export type HostTemplateVariable = (typeof HOST_TEMPLATE_VARIABLES)[number];
export type HostTemplateValues = Readonly<Partial<Record<HostTemplateVariable, string>>>;

const names: ReadonlySet<string> = new Set(HOST_TEMPLATE_VARIABLES);

export function isHostTemplateVariable(name: string): name is HostTemplateVariable {
	return names.has(name);
}
