// Manually exported types from citadel-workspace-types
// TODO: Replace with auto-generated types from ts-rs

export interface User {
  id: string;
  name: string;
  role: UserRole;
  permissions: Record<string, Permission[]>;
  metadata: Record<string, MetadataValue>;
}

export type UserRole = 
  | "Admin"
  | "Owner"
  | "Member"
  | "Guest"
  | "Banned"
  | { Custom: [string, number] };

export type Permission =
  | "All"
  | "CreateRoom"
  | "DeleteRoom"
  | "UpdateRoom"
  | "CreateOffice"
  | "DeleteOffice"
  | "UpdateOffice"
  | "CreateWorkspace"
  | "UpdateWorkspace"
  | "DeleteWorkspace"
  | "EditContent"
  | "AddUsers"
  | "RemoveUsers"
  | "EditMdx"
  | "EditRoomConfig"
  | "EditOfficeConfig"
  | "AddOffice"
  | "AddRoom"
  | "UpdateOfficeSettings"
  | "UpdateRoomSettings"
  | "ViewContent"
  | "ManageOfficeMembers"
  | "ManageRoomMembers"
  | "SendMessages"
  | "ReadMessages"
  | "UploadFiles"
  | "DownloadFiles"
  | "ManageDomains"
  | "ConfigureSystem"
  | "EditWorkspaceConfig"
  | "BanUser";

export interface MetadataField {
  key: string;
  value: MetadataValue;
}

export type MetadataValue =
  | { type: "String"; content: string }
  | { type: "Number"; content: number }
  | { type: "Boolean"; content: boolean }
  | { type: "Array"; content: MetadataValue[] }
  | { type: "Object"; content: Record<string, MetadataValue> }
  | { type: "Null"; content: null };

export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  members: string[];
  offices: string[];
  metadata: number[];
  password_protected: boolean;
}

export interface Office {
  id: string;
  owner_id: string;
  workspace_id: string;
  name: string;
  description: string;
  members: string[];
  rooms: string[];
  mdx_content: string;
  metadata: number[];
}

export interface Room {
  id: string;
  owner_id: string;
  office_id: string;
  name: string;
  description: string;
  members: string[];
  mdx_content: string;
  metadata: MetadataField[];
}

export type Domain =
  | { Workspace: string }
  | { Office: string }
  | { Room: string };

export type WorkspaceProtocolPayload =
  | { Request: WorkspaceProtocolRequest }
  | { Response: WorkspaceProtocolResponse };

export type WorkspaceProtocolRequest =
  | { CreateWorkspace: { name: string; description: string; workspace_master_password: string; metadata?: number[] } }
  | "GetWorkspace"
  | { UpdateWorkspace: { name?: string; description?: string; workspace_master_password: string; metadata?: number[] } }
  | { DeleteWorkspace: { workspace_master_password: string } }
  | { CreateOffice: { workspace_id: string; name: string; description: string; mdx_content?: string; metadata?: number[] } }
  | { GetOffice: { office_id: string } }
  | { UpdateOffice: { office_id: string; name?: string; description?: string; mdx_content?: string; metadata?: number[] } }
  | { DeleteOffice: { office_id: string } }
  | "ListOffices"
  | { CreateRoom: { office_id: string; name: string; description: string; mdx_content?: string; metadata?: number[] } }
  | { GetRoom: { room_id: string } }
  | { UpdateRoom: { room_id: string; name?: string; description?: string; mdx_content?: string; metadata?: number[] } }
  | { DeleteRoom: { room_id: string } }
  | { ListRooms: { office_id: string } }
  | { AddMember: { user_id: string; office_id?: string; room_id?: string; role: UserRole; metadata?: number[] } }
  | { GetMember: { user_id: string } }
  | { UpdateMemberRole: { user_id: string; role: UserRole; metadata?: number[] } }
  | { UpdateMemberPermissions: { user_id: string; domain_id: string; permissions: Permission[]; operation: UpdateOperation } }
  | { RemoveMember: { user_id: string; office_id?: string; room_id?: string } }
  | { ListMembers: { office_id?: string; room_id?: string } }
  | { Message: { contents: number[] } };

export type WorkspaceProtocolResponse =
  | { Workspace: Workspace }
  | { Success: string }
  | { Error: string }
  | { Offices: Office[] }
  | { Rooms: Room[] }
  | { Members: User[] }
  | { Office: Office }
  | { Room: Room }
  | { Member: User };

export type UpdateOperation = "Add" | "Set" | "Remove";

export type ListType =
  | "MembersInWorkspace"
  | { MembersInOffice: { office_id: string } }
  | { MembersInRoom: { room_id: string } };

export type PermissionEndowOperation = "Add" | "Remove" | "Replace";