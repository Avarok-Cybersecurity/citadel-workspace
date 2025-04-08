# Citadel Workspace MVP Implementation Plan

## Overview

This document outlines the implementation plan for core features of the Citadel Workspace application:

1. User Authentication (Registration and Login)
2. MDX Content Editing & Permissions
3. User Discovery
4. Messaging System

For each feature, we'll analyze:
- Current implementation status
- Required components
- Implementation steps
- Dependencies and prerequisites

## 1. User Authentication System

### Current Status

- **Login**: Implemented 
  - Login UI component exists (`citadel-workspaces/src/components/Login.tsx`)
  - Backend uses Citadel Internal Service for authentication
  - Connect command and handlers are functional
  
- **Registration**: Implemented as "Join Workspace"
  - Registration UI exists in `citadel-workspaces/src/components/Join.tsx`
  - Flow for creating new users during workspace join is in place
  - Backend registration handlers are already implemented

### Required Enhancements

- **Session Management**:
  - Review token storage and validation
  - Ensure proper session expiration handling
  - Add session recovery mechanisms
  
- **User Profile Management**:
  - Create profile editing capabilities
  - Add avatar and personal information management
  - Implement password change functionality

### Implementation Steps

1. **Review Authentication Flow**:
   - Audit existing login/join process
   - Identify any security vulnerabilities
   - Ensure proper error handling and validation

2. **Enhance User Profiles**:
   - Implement profile editing UI
   - Add avatar upload capabilities
   - Create settings page for account management

## 2. MDX Content Editing & Permissions

### Current Status

- **MDX Editing**: Implemented
  - Basic MDX editing for offices implemented in `BaseOffice.tsx`
  - Basic MDX editing for rooms implemented in `Room.tsx`
  - Backend storage for `mdx_content` field exists in Office and Room structures
  
- **MDX Rendering**: Implemented
  - MDX compilation and rendering works for both offices and rooms
  - Components system for MDX content is in place
  
- **Permissions**: Partially implemented
  - Role-based system exists (Owner, Admin, Member, Guest)
  - Need specific permission for MDX content editing

### Required Enhancements

- **MDX Editing Experience**:
  - ✅ Add rich text editor toolbar for non-technical users
  - ✅ Implement media embedding and file uploads
  - ✅ Create MDX content templates for different office/room types

- **Permission System**:
  - ✅ Add specific permission for MDX content editing
  - ✅ Ensure Owners of Offices and Rooms can edit MDX content by default
  - ✅ Create UI for permission management

### Implementation Steps

1. **Enhance MDX Editor**:
   - ✅ Add toolbar with formatting buttons
   - ✅ Implement media upload and embedding
   - ✅ Create preview functionality

2. ✅ **Implement MDX Content Permissions**:
   - ✅ Add `canEditMdxContent` permission to permission model
   - ✅ Modify Office and Room components to check for edit permission
   - ✅ Ensure Owners automatically have edit permissions
   - ✅ Add UI controls that respect permission settings

## 3. User Discovery

### Current Implementation

The user discovery functionality includes:

- ✅ User search with filtering capabilities
- ✅ User profile viewing with detailed information
- ✅ Integration with the messaging system
- ✅ User directory with online/offline status

### Required Enhancements

- **User Directory**:

  - ✅ Complete user directory page
  - ✅ User search functionality
  - ✅ User profile cards
  - User status indicators with presence
  - Connection requests

- **User Profiles**:

  - ✅ Profile viewing interface
  - Profile editing capabilities
  - Profile customization options

### Implementation Steps

1. ✅ **Create User Search Component**:

   - ✅ Implement search functionality
   - ✅ Add filtering capabilities
   - ✅ Integrate with user data

2. ✅ **Build User Directory Page**:

   - ✅ Create user listing
   - ✅ Implement user filtering (online, favorites)
   - ✅ Add profile viewing functionality

## 4. Messaging System

### Current Implementation

The basic messaging functionality includes:

- ✅ Message sending/receiving via the Tauri API
- ✅ Real-time messaging with the MessagingService integration
- ✅ Typing indicators to show when users are typing
- ✅ Message status tracking (pending, sent, failed)
- ✅ Retry mechanism for failed messages
- ✅ Connection-based message permission system

### Required Enhancements

- **Chat UI Improvements**:

  - ✅ Clean, modern interface for messaging
  - ✅ Real-time message updates
  - ✅ Typing indicators
  - Message history and pagination
  - Read receipts

- **Message Features**:

  - ✅ Basic text messaging
  - File/media sharing
  - Message formatting
  - Emoji support

- **Connection Management**:
  
  - ✅ P2P registration requests with manual/auto acceptance
  - ✅ P2P connection management for messaging
  - Unified notification system for messages and connection events

### Implementation Steps

1. ✅ **Enhance Messaging UI**:

   - ✅ Create dedicated MessagingService
   - ✅ Implement real-time updates
   - ✅ Add typing indicators
   - Add message history loading

2. **Add Advanced Messaging Features**:

   - Implement message status tracking
   - Add file and media sharing
   - Create notification system for messages and connection events

## Implementation Roadmap

### Phase 1: Core Functionality Enhancement
- ✅ Add MDX editing permission controls
- ✅ Ensure permissions are enforced for content editing
- ✅ Enhance MDX editor with rich text toolbar

### Phase 2: User Experience Improvements
- ✅ Complete user search and discovery features
- ✅ Enhance user profiles and presence indicators
- ✅ Improve messaging UI and conversation management
- ✅ Add MDX content templates for different space types

### Phase 3: Advanced Features
- Add media sharing in messages
- Implement collaborative editing for MDX content
- Create notification system for messages and updates
- Develop MDX content templates for different space types

## Gap Analysis Summary

| Feature | Status | Implementation Effort | Priority |
|---------|--------|----------------------|----------|
| Login/Registration | Implemented | Low | Completed |
| MDX Editing | Implemented | Low | Completed |
| MDX Edit Permissions | ✅ Implemented | Medium | Completed |
| Rich Text MDX Editor | ✅ Implemented | Medium | Completed |
| User Search | ✅ Implemented | Medium | Completed |
| Messaging UI | ✅ Implemented | Medium | Completed |
| Connection Requests | ✅ Implemented | Medium | Completed |
| Notification System | Not Implemented | Medium | Current Focus |
| MDX Templates | ✅ Implemented | Medium | Completed |
| File/Media Sharing | Not Implemented | High | Planned |

## Next Steps

1. ✅ Implement MDX editing permissions:
   - ✅ Add `canEditMdxContent` permission
   - ✅ Ensure Office/Room Owners can edit by default
   - ✅ Add permission checks to edit buttons

2. ✅ Enhance MDX editor:
   - ✅ Create rich text toolbar
   - ✅ Add media embedding capabilities
   - ✅ Implement content templates for different office/room types

3. Complete messaging UI:
   - ✅ Connect existing components to real data
   - ✅ Add conversation management
   - Implement notification system for messages and connection events

4. Complete user discovery features:
   - ✅ Implement user search
   - ✅ Create user directory
   - ✅ Add user connection requests

5. Current Development Focus:
   - Create a unified notification system for messages and connection events
   - ✅ Develop MDX content templates for different office/room types
   - Add file/media sharing capabilities in messages
