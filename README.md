# MISU - Microsoft Suzhou Toastmasters Club

IN CONSTRUCTION.

This is a running service to provide basic information and util tools for organizaing MISU activities.

A MISU regular meeting involves these stages:

- Before the meeting:
    - Meeting published with information of time, venue and roles.
    - Users with editing access register roles, like prepared speakers, table topic masters, evaluators, etc.
    - Members need to provide more information for roles like prepared speakers.
    - Meeting poster and agenda published.
- During the meeting:
    - Attendees check in.
    - Timer records the time consumed in each session, reminding role takers if necessary.
    - Fill in Table Topic participants information to generate the voting page.
    - Users with editing access vote for the best roles. The results will be collected and announced.
- After the meeting:
    - Attendees might upload pictures, files and so on.

The service is also intended to track the information of meetings, members, role takers; and the agendas, posters, pictures, files.

Accounts use email and password on the web and mini program. New accounts are guests:
they can view pages, but cannot edit, book roles, check in, or vote until an administrator
grants editing access. Existing accounts retain their records and access and can connect
email credentials. See [backend authentication documentation](apps/backend/README.md)
for migration and access-management instructions.


See `./design` for the architecture, data schema and designed functionalities.