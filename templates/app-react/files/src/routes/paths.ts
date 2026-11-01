export const ROUTE = {
    SIGNIN: '/{{ app.key }}/auth/signin',
    HOME: '/{{ app.key }}/home',
    PROFILE: '/{{ app.key }}/profile',
    ROLES: '/{{ app.key }}/roles',
{{#if app.feature.invitations}}
    INVITATIONS: '/{{ app.key }}/invitations',
    ACCEPT_INVITATION: '/{{ app.key }}/auth/accept-invitation',
{{/if}}
} as const;
