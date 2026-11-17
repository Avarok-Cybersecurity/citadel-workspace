import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, Mail, UserPlus, Clock, UserX, User, Search, AlertCircle, CheckCircle } from 'lucide-react';
import { formatPresence } from '@/lib/date-utils';
import type { UserData } from '@/components/user/UserSearch';
import { MemberRoleBadge } from '@/components/shared/MemberRoleBadge';

interface UserProfileCardProps {
  selectedUser: UserData | null;
  /** The reader's own profile: there is nobody to connect to. */
  isSelf: boolean;
  isConnected: boolean;
  onClose: () => void;
  onSendMessage: (userId: string) => void;
  onInvite: (userId: string) => void;
}

export function UserProfileCard({
  selectedUser,
  isSelf,
  isConnected,
  onClose,
  onSendMessage,
  onInvite,
}: UserProfileCardProps): JSX.Element {
  if (!selectedUser) {
    return (
      <Card className="bg-card border-border text-foreground h-full shadow-sm flex flex-col justify-center items-center p-6">
        <div className="text-center">
          <Avatar className="h-20 w-20 mb-4 mx-auto">
            <AvatarFallback className="bg-muted text-muted-foreground">
              <User className="h-10 w-10" />
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-xl mb-2">Select a User</CardTitle>
          <CardDescription className="text-muted-foreground mb-6">
            Click on a user or search to view their profile
          </CardDescription>
          <Button
            variant="outline"
            className="border-border text-foreground/80 hover:bg-accent hover:text-foreground"
            onClick={() => document.querySelector('input')?.focus()}
          >
            <Search className="h-4 w-4 mr-2" />
            Search Users
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border text-foreground h-full shadow-sm">
      <CardHeader className="text-center pb-2 relative">
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground hover:bg-accent"
          aria-label="Close profile"
          onClick={onClose}
        >
          <UserX className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center">
          <div className="mb-4">
            <MemberAvatar username={selectedUser.id} name={selectedUser.displayName} className="h-20 w-20 text-xl" online={selectedUser.isOnline === true} />
          </div>
          <CardTitle className="text-xl mb-1">{selectedUser.displayName}</CardTitle>
          <MemberRoleBadge holder={selectedUser} className="mb-2" />
          {selectedUser.email && (
            <CardDescription className="text-muted-foreground flex items-center justify-center mb-2">
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              {selectedUser.email}
            </CardDescription>
          )}
          <CardDescription className="text-muted-foreground flex items-center justify-center">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            {formatPresence(selectedUser.isOnline ?? null, selectedUser.lastActive)}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">About</h4>
            <p className="text-sm text-muted-foreground italic">
              No bio provided
            </p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Connection Status</h4>
            <div className="p-3 rounded-md bg-card flex items-center space-x-3">
              {isSelf ? (
                <>
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">This is you</p>
                    <p className="text-xs text-muted-foreground">Others in the workspace see this profile</p>
                  </div>
                </>
              ) : isConnected ? (
                <>
                  <CheckCircle className="h-5 w-5 text-success-emphasis" />
                  <div>
                    <p className="text-sm font-medium text-foreground">In your contacts</p>
                    <p className="text-xs text-muted-foreground">You can message this user</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-warning-emphasis" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Not a contact yet</p>
                    <p className="text-xs text-muted-foreground">Send a connection request to message this user</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* TODO: Wire to real workspace membership data when available */}
        </div>
      </CardContent>

      {!isSelf && <CardFooter className="flex justify-between border-t border-border pt-4">
        {!isConnected ? (
          <Button
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => onInvite(selectedUser.id)}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Send Connection Request
          </Button>
        ) : (
          <>
            {/* "Remove Connection" stood here with no onClick, in no form -- a
                destructive-looking control that did nothing, which teaches the
                user that disconnecting is broken. There is no peer
                deregistration flow in the frontend at all, so the honest thing
                is not to offer it. This is round 131's finding (both Invite
                buttons had no onClick) one branch over in the same component;
                the fix was never propagated to the connected case. */}
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => onSendMessage(selectedUser.id)}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Message
            </Button>
          </>
        )}
      </CardFooter>}
    </Card>
  );
}
