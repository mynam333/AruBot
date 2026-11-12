export type CommandPermission = 'streamer' | 'manager' | 'subscriber' | 'everyone';
export type CommandPermissionRule = { executionPermission?: CommandPermission | null; requiredRoleLevel?: number; adminOnly?: boolean };
export const COMMAND_PERMISSION_OPTIONS: { value: CommandPermission; label: string }[];
export function isCommandPermission(value: unknown): value is CommandPermission;
export function getCommandPermission(rule?: CommandPermissionRule): CommandPermission;
export function commandPermissionLabel(rule: CommandPermissionRule): string;
export function canExecuteCommand(rule: CommandPermissionRule, actor?: { roleLevel?: number; isOwner?: boolean; isManager?: boolean; isSubscriber?: boolean }): boolean;
