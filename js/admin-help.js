/*
  Help for the admin pages (admin.html and track-admin.html): a small "?" beside each panel title and beside the
  controls that are not obvious. It opens a popover saying what the panel or control is for and what each option
  does (and does not do), so the busy pages can be used without remembering it all.

  HELP is keyed by element id. A panel is a <details id="...-wrap">: its "?" goes at the end of the panel title. Any other
  id (a button or a switch) gets its "?" straight after it. Each entry is { t: title, p: what it is for, i: [[option, what
  it does], ...] }. The buttons are added once, and again for anything the pages draw later.
*/
(function () {
  var HELP = {
    // ---------------------------------------------------------------- the top of both pages
    'load-btn': { t: 'Load', p: 'Brings up every panel using the admin key typed in the box.', i: [
      ['The key', 'It is kept for this tab only, unless Remember the key on this device is switched on.'],
      ['Admin viewer', 'Entering the key also leaves a month-long admin viewer token in this browser, so unpublished events and Owner Interviews open for you here. Changing the admin key ends every one of them.']
    ] },
    'refresh-btn': { t: 'Refresh', p: 'Loads every panel again from the server without leaving the page. It changes nothing.' },
    'alerts-bell': { t: 'Bell', p: 'Shows or hides the notification bell at the top of the admin pages.', i: [
      ['On', 'The bell counts what is waiting for you (claims, requests, reports, new sessions) and opens the panel it belongs to.'],
      ['Off', 'The bell is hidden on admin.html and track-admin.html. Nothing is lost: the items are still in their panels.']
    ] },
    'alerts-email': { t: 'Email', p: 'Controls the emails MT3UK gets whenever something needs you.', i: [
      ['On', 'Every new claim, request, sign-up, report or session is emailed to MT3UK as well as shown on the bell.'],
      ['Off', 'Those emails stop. Emails to members (sign-in links, approvals, messages) are not affected.'],
      ['Push', 'Push notifications to a device still go out whatever this says.']
    ] },
    'alerts-sessions': { t: 'New sessions', p: 'Turns the whole new-session alert off or on.', i: [
      ['On', 'Each session a member saves is listed on the New sessions panel, counted on the bell and emailed.'],
      ['Off', 'Nothing is listed, counted or emailed for new sessions. The Bell and Email switches still apply on top of this one.']
    ] },
    'alerts-push': { t: 'Push on this device', p: 'Sends the alerts to this device as notifications, even when the page is closed.', i: [
      ['Per device', 'It is off until you switch it on, and each device is set separately.'],
      ['iPhone', 'On an iPhone it only works from the installed Admin app.']
    ] },
    'alerts-keep': { t: 'Remember the key on this device', p: 'Keeps the admin key on this device so the page opens ready, including the installed app.', i: [
      ['Careful', 'Anyone who can use this device can then open the admin pages. Leave it off on a shared or borrowed computer.']
    ] },
    'alerts-install': { t: 'Install', p: 'Installs this page as its own app on this device, so it opens in its own window with its own icon.', i: [
      ['Android', 'Chrome installs the admin apps from admin.mt3uk.com, so the button takes you there.']
    ] },

    // ---------------------------------------------------------------- admin.html: gallery and builds
    'pending-wrap': { t: 'Pending claims', p: 'Members who have asked to take ownership of a photo in the gallery. Each card shows the photo, who asked, any note they left and when.', i: [
      ['Approve', 'Gives the photo to that member. If they were not signed in, they are sent a sign-in link.'],
      ['Reject', 'Refuses the claim. The photo stays in the gallery, unclaimed.'],
      ['Delete photo', 'Removes the photo, its likes, any claim and reports for good. It cannot be undone.']
    ] },
    'decided-wrap': { t: 'Decided claims', p: 'Claims already approved or rejected, with the result on each card.', i: [
      ['Undo', 'Takes the decision back and moves the claim to Pending claims again.'],
      ['Completed', 'Tidies the claim off this list. The photo stays with its current owner.'],
      ['Delete photo', 'Removes the photo, its likes, claim and reports for good.']
    ] },
    'unclaimed-wrap': { t: 'Unclaimed photos', p: 'Gallery photos that have no owner yet.', i: [
      ['Assign', 'Type or pick a member\'s email and press Assign: after a confirm, the photo is given to that member.'],
      ['Has a pending claim request', 'Someone has asked for it: decide it under Pending claims.'],
      ['Delete photo', 'Removes the photo, its likes and reports for good.']
    ] },
    'votes-wrap': { t: 'Build of the Week entries', p: 'This week\'s vote, newest first.', i: [
      ['Remove from voting', 'Takes the photo out of the vote and deletes its votes for this week. The photo stays in the gallery and the reel, the owner cannot put it back in, but they can enter a different photo.'],
      ['Taken out of voting', 'The photos you have already removed.']
    ] },
    'garage-asks-wrap': { t: 'Other makes', p: 'Cars and bikes that are not Teslas are private: only the owner sees them, in their garage, where they can still build a mods list and use the car in Track sessions. They are kept out of the Gallery, the Reel and Build of the Week.', i: [
      ['Make public', 'On a request from the owner: puts the photos in the Gallery and the Reel (Voting stays off until the owner enters a photo). The owner is emailed.'],
      ['Keep private', 'Leaves the car in the garage only. The owner is emailed.'],
      ['Find them', 'Lists non-Tesla cars that anyone can still see: older ones added before the rule, and ones you made public (marked with the date).'],
      ['Remove from public view', 'Makes that car private again. Nothing is deleted and the car stays in its owner\'s garage.']
    ] },
    'ga-find': { t: 'Find them', p: 'Lists every car or bike that is not a Tesla and is still on public view (an Ioniq or a Taycan added before only Teslas went in, or one you made public). Nothing changes until you press Remove from public view on a car.' },
    'ga-email': { t: 'Email the owner', p: 'On: when you press Remove from public view, the owner is emailed to say their car is now private. Off: it happens silently. It starts on.' },

    // ---------------------------------------------------------------- admin.html: reports
    'comments-wrap': { t: 'Reported comments', p: 'Comments members have reported, grouped by the photo they are on.', i: [
      ['Delete', 'Deletes that comment permanently, after a confirm.'],
      ['Leaving it', 'A comment you do nothing about stays up.']
    ] },
    'rphotos-wrap': { t: 'Reported photos', p: 'Photos members have reported.', i: [
      ['Dismiss', 'Clears the reports and keeps the photo live.'],
      ['Delete photo', 'Removes the photo, its likes, claim and reports for good. It cannot be undone.']
    ] },
    'local-wrap': { t: 'Reported in this browser', p: 'Photos this browser has flagged itself, so they show as "Reported" (disabled) on the public site here. It is separate from the server reports above, so clearing one only affects this browser.' },

    // ---------------------------------------------------------------- admin.html: members
    'subscribers-wrap': { t: 'Subscribers', p: 'Everyone with an MT3UK account. Members and subscribers are the same people.', i: [
      ['Send subscribers email now', 'Emails the list of members to modtesla3uk@gmail.com straight away. It also goes out every day at 8pm.'],
      ['Add subscriber', 'Adds a member by first name, last name and email without them signing up.'],
      ['Search and dates', 'Find by name, nickname or email, or by the dates they were added.'],
      ['Edit', 'Changes a member\'s name or email.'],
      ['Send sign-in link', 'Emails them a new one-time sign-in link for My Garage.'],
      ['Delete', 'Deletes the member. Their photos go back to unclaimed.'],
      ['Remove (on a photo)', 'Takes that photo off the member. It goes back to unclaimed.']
    ] },
    'send-digest-btn': { t: 'Send subscribers email now', p: 'Sends the list of members to modtesla3uk@gmail.com right now, after a confirm. The same email goes out every day at 8pm on its own.' },
    'add-subscriber-btn': { t: 'Add subscriber', p: 'Adds a member from the first name, last name and email in the boxes, without them having to sign up. They can sign in with an emailed link.' },
    'members-msg-wrap': { t: 'Messages to subscribers', p: 'Write to every member. A message always goes to their Profile inbox and the bell shows it to them as unread.', i: [
      ['Also send it by email', 'Emails it too. Members who have turned emails off are skipped.'],
      ['Send message', 'Sends it to every member, after a confirm.'],
      ['Send a test', 'Emails the title and message to one address with [Test] in the subject. Nothing is saved or sent to anyone else. Choose how it is sent (as members get it, with an unsubscribe header, or plain like a sign-in email) to find what sends it to Junk.'],
      ['Email to everyone not emailed yet', 'On a message already sent: emails the members who have not had it by email.'],
      ['Remove from inboxes', 'Takes the message out of everyone\'s Profile inbox. Emails already sent cannot be unsent.'],
      ['Reported friend messages', 'Members can report a message a friend sent. Remove deletes that message. Block also stops the sender messaging anyone until you unblock them.']
    ] },
    'bc-test-btn': { t: 'Send test', p: 'Emails this title and message to the one address typed in, marked [Test], using the way chosen in the drop-down. Nothing is saved or sent to anyone else.' },

    // ---------------------------------------------------------------- admin.html: owner interviews
    'interviews-wrap': { t: 'Owner interviews', p: 'The pipeline of owner interviews: what is published, what is scheduled and where the schedule has gaps.', i: [
      ['Release every', 'How often a new interview should go out. It is used to find the next free slot and to point out gaps.'],
      ['Time to build one', 'How long an interview takes to put together, so the page can say when the next one needs starting.'],
      ['Edit interviews', 'Opens the publish dates for changing. Nothing is saved until you press Review changes.'],
      ['Review changes', 'Shows each change for you to check, then saves it as one update to data/interviews.json. The site updates within a minute or so.'],
      ['Cancel', 'Leaves editing without saving.'],
      ['Search and filters', 'Narrow the list by name, title, car or page, by Standard or Track type, by Scheduled or Published, and sort it. Clear resets them.'],
      ['Drafts', 'Interviews with no publish date yet, kept apart from the schedule.']
    ] },
    'iv-edit-btn': { t: 'Edit interviews', p: 'Opens the publish dates of the interviews so they can be changed. Nothing is saved until you press Review changes and confirm.' },
    'preview-wrap': { t: 'Interview previews', p: 'Until an interview is published, anyone can ask for a one-time code on its page. A code opens that interview for 4 hours, signs them in, and makes them a member if they were not one already. This lists everyone who has opened one.', i: [
      ['Revoke', 'Ends their preview straight away and stops new codes for that email.'],
      ['Restore', 'Undoes a revoke.'],
      ['The form', 'Revoke an email for one interview or for all of them.']
    ] },

    // ---------------------------------------------------------------- admin.html and track-admin.html: sharing
    'home-share-wrap': { t: 'Homepage sharing', p: 'The picture a shared homepage link shows in WhatsApp, Facebook and the rest.', i: [
      ['Add a picture', 'Pick a photo from the build gallery, upload one, or draw a card from a saved track session. Give each a caption.'],
      ['A different picture each week', 'On: the week\'s picture is taken in turn from the saved ones. Off: the one you pick is always used.'],
      ['Save to the pictures', 'Keeps the new picture in the set.'],
      ['No picture saved', 'The link keeps its usual picture.'],
      ['Timing', 'A change is picked up within a few minutes. A link already sent in a chat keeps its old picture.']
    ] },
    'share-wrap': { t: 'Track sessions sharing', p: 'The picture a shared Track sessions link shows in WhatsApp, Facebook and the rest.', i: [
      ['Add a picture', 'Draw a card from a saved session (its map, times and g chart) or upload a photo. Give it a caption.'],
      ['A different picture each week', 'On: the week\'s picture is taken in turn from the saved ones. Off: the one you pick is always used.'],
      ['Save to the pictures', 'Keeps the new picture in the set.'],
      ['Also used', 'The picture on the Laps front page is the one picked here.'],
      ['Timing', 'Previews update within a few minutes of a change. A link already sent in a chat keeps its old picture.']
    ] },

    // ---------------------------------------------------------------- track-admin.html: access
    'access-wrap': { t: 'Early access', p: 'Track Sessions is an early preview. Members ask for access and wait here.', i: [
      ['Approve', 'Lets that member use Track Sessions, and emails them.'],
      ['Decline', 'Refuses the request.'],
      ['Open to all members', 'Lets every member in without changing any code. Switch it off to go back to the approved list only.'],
      ['Add current testers', 'Press once: it puts members who already had sessions before the preview on the approved list, so they can be revoked like anyone else. After that the list alone decides.'],
      ['Approve by email', 'Add someone to the approved list by typing their email.'],
      ['Approved', 'Everyone allowed in. Revoke takes a member off.'],
      ['Still open to everyone', 'Shared sessions, the leaderboards and the track list.']
    ] },
    'ac-open': { t: 'Open to all members', p: 'On: every member can use Track Sessions, whatever the list says. Off: only the approved members can. It needs no code change, so it is the switch for opening the preview to everyone.' },
    'ac-import': { t: 'Add current testers', p: 'Puts every member who already had sessions before the preview on the approved list. Press it once. After that the approved list alone decides who has access, so they can be revoked like anyone else.' },
    'signin-wrap': { t: 'Sign-in and sign-up', p: 'How signing in and joining works on laps.mt3uk.com. A sign-in is kept per address, so the emailed link always comes back to the address it was asked from.', i: [
      ['Laps has its own sign-in page and emails', 'On (the default): Laps shows its own sign-in page and sends the Laps emails. Off: the Laps sign-in page passes people to the MT3UK one and the MT3UK emails are sent. The link still comes back to laps.mt3uk.com.'],
      ['New Laps sign-ups become MT3UK members too', 'On (the default): joining on Laps makes a full MT3UK member. Off: joining on Laps makes a Laps-only account, which can sign in on Laps but not on mt3uk.com. Joining on mt3uk.com later upgrades it.'],
      ['Email wording', 'The opening line of the Laps sign-in and welcome emails. Blank keeps the built-in words.'],
      ['Save', 'Keeps these settings.'],
      ['New Laps sign-ups', 'Everyone who has joined on Laps, newest first, with their account type. Clear takes one off the list.']
    ] },
    'ls-separate': { t: 'Laps has its own sign-in page and emails', p: 'On (the default): Laps shows its own sign-in page and sends Laps-branded emails. Off: the Laps sign-in page passes visitors on to the MT3UK sign-in and the MT3UK emails are sent. Either way the emailed link comes back to laps.mt3uk.com.' },
    'ls-mt3uk-too': { t: 'New Laps sign-ups become MT3UK members too', p: 'On (the default): joining on Laps makes a full MT3UK member. Off: joining on Laps makes a Laps-only account, which can sign in on Laps but not on mt3uk.com. If that person joins on mt3uk.com later they become a full member.' },
    'usage-wrap': { t: 'Usage', p: 'How Laps is being used, for deciding whether a paid tier is worth building.', i: [
      ['Members', 'Members with sessions, how many were active in the last 30 and 90 days, new ones, those who came back (sessions in two or more months) and those with only one session.'],
      ['Sessions', 'Saved in all and in the last 30 and 90 days, how many are shared, how many keep their readings and the storage they take, split by type.'],
      ['Each week', 'Sessions saved a week for 12 weeks, with how many vehicles.'],
      ['Vehicles and boards', 'Vehicles by make, boards with entries, and the access list.'],
      ['Count again', 'Reads everything again. It can take a moment on a big list.'],
      ['Dates', 'They are when a session was saved, not when it was driven.']
    ] },
    'us-load': { t: 'Count again', p: 'Reads every member\'s session list again and recounts. It only reads, changes nothing, and can take a moment.' },

    // ---------------------------------------------------------------- track-admin.html: members' sessions
    'new-sessions-wrap': { t: 'New sessions', p: 'Every session a member saves is listed here, counted on the bell and emailed to MT3UK with the member, car, track, result and a link.', i: [
      ['Clear', 'Takes that session off the list once you have seen it.'],
      ['Clear all', 'Empties the list.'],
      ['The switch at the top', 'New sessions turns all of this off: nothing is listed, counted or emailed. The Email switch still covers the email.']
    ] },
    'ns-clear-all': { t: 'Clear all', p: 'Takes every session off the New sessions list and the bell. The sessions themselves are not touched.' },
    'lines-wrap': { t: 'Line editing', p: 'A member cannot move the start and finish lines on a session they have saved. They press Request Edit Map on it and wait here.', i: [
      ['Allow', 'Lets them edit that one map, and emails them.'],
      ['Sent for approval', 'When they send a change you are emailed the lines and time as they were and would be, with the old and new lines pictured on the map. Nothing changes until you decide.'],
      ['Accept', 'Works the time out again from the saved readings and shows you the result first. On a listed course it makes the new lines the course\'s official lines and re-times every other session at that track (a time that moves by over 10% is held back), so it can change other members\' times.'],
      ['Undo', 'Throws the change away. The session stays as it was.'],
      ['Revoke', 'Switches that member\'s editing off once they are done.'],
      ['Rename the track', 'The same steps for renaming a track on a session at a track we do not list. Accept changes the name on that session only.']
    ] },
    'member-sessions-wrap': { t: 'Member sessions', p: 'Look at a member\'s sessions, even private ones, to help them.', i: [
      ['Find sessions', 'Search by email. You get a read-only view without their notes.'],
      ['Logged', 'Each view is logged under Recent admin views, and members are told in the privacy page.'],
      ['Rename', 'A session at a track we do not list can be renamed here. One at a listed track takes its name from the Tracks panel.']
    ] },
    'ms-find': { t: 'Find sessions', p: 'Lists the sessions of the member with the email typed in, including private ones, in a read-only view without their notes. Each look is logged under Recent admin views.' },

    // ---------------------------------------------------------------- track-admin.html: tracks
    'tracks-wrap': { t: 'Tracks', p: 'The tracks, courses and drag strips Track Sessions recognises from a member\'s file.', i: [
      ['New track requests', 'A member saved a session at a place or layout we could not place. Open map checks its lines first. Approve and add track makes the layout or course from the request and links that member\'s sessions. Set up by hand opens the form instead. Dismiss closes it.'],
      ['Added by a member, to review', 'A member added the track or layout themselves with Add this track now. It is live already. Mark reviewed clears the flag, Edit the track opens it for changes.'],
      ['Map: (layout name)', 'Opens the satellite map to see or move that layout\'s start (and finish) line.'],
      ['Edit', 'Changes the track\'s name, position, type and its layouts: length, start and finish lines (Set the start line on the map), organiser, sectors and corners.'],
      ['Check sessions here', 'Lists every session at that track with the time it has and the time it would get, and saves nothing.'],
      ['Re-time sessions here', 'Works every session at that track out again from its saved readings on the track\'s lines as they are now, then rebuilds the leaderboards. Use it after correcting a track\'s lines. A time that moves by over 10% is held back unless the switch is on.'],
      ['Remove', 'Takes the track off the list. Sessions already saved keep their name.'],
      ['Add hill climb, sprint, drag strip', 'Adds a second entry for the same place as another kind.'],
      ['Official lines', 'A layout with an official start line times every session on it the same way, so results can be compared. A layout with no line is timed from each member\'s own line until you set one.']
    ] },
    'tk-list-wrap': { t: 'Tracks list', p: 'Every track, in alphabetical order. Filter by track name or by type (Circuit, Sprint, Hill climb, Drag strip). Each layout has buttons to open its map, edit it, check or re-time its sessions, or remove it.' },

    // ---------------------------------------------------------------- track-admin.html: leaderboards
    'board-checks-wrap': { t: 'Problems and checks', p: 'Find out why a session is not on a leaderboard, one at a time or all at once.', i: [
      ['Check', 'Paste a session link or id. It says which board the session belongs on (Track days, Sprint, Hill climb or Drag), whether its car is on it, and what is stopping it if not.'],
      ['Find problems', 'Looks through the shared sessions and lists every one that is not on a board for a fixable reason, and any board that has entries but no count.'],
      ['Repair', 'Writes the session, its car\'s shared list and the board again from the session\'s own record. If the track or layout has gone from the list, it finds the listed one it looks like and links the session to it.'],
      ['Never changes times', 'It only fixes where a session is listed. Use Re-time to change times.']
    ] },
    'ms-check': { t: 'Check', p: 'Paste a session link or id: it says which board that session belongs on, whether its car is on that board, and, if not, what is stopping it (sharing set to Only me, no track or layout matched, a request still waiting, taken off by you, or another session being the car\'s fastest).' },
    'ms-problems': { t: 'Find problems', p: 'Looks through the first 700 members\' session lists and shows every shared session that is not on a board for a fixable reason, with the reason, plus any board that has entries but no count in the track list. Each one has a Repair button. It only reads until you press Repair.' },
    'boards-wrap': { t: 'Rebuild and re-time', p: 'Tools to bring leaderboards and saved sessions up to date after something changes.', i: [
      ['Rebuild all leaderboards', 'Goes through every car, a few at a time, and rewrites its entry on each board it is on: its best for every mix of conditions and tyres, its track-relevant mods, make and model, driven wheels, and the board\'s count and top three. It changes no session or time and is safe to run any time.'],
      ['Check sessions', 'A dry run. Lists the sessions timed with an older version of the timing code that still have their saved readings, with the time they have and the time they would get. Saves nothing.'],
      ['Re-time out of date sessions', 'The same, but it saves, after a confirm. Each session is read again from its saved readings with the member\'s own settings, its laps, times and figures are replaced, and the leaderboards are rebuilt. Sessions already on the current version, mapped drives and sessions with no readings kept are skipped.'],
      ['Also re-time big changes', 'A safety catch. Off: a session whose best time would move by more than 10% is held back and listed (that usually means the wrong lines or laps). On: those are saved too.']
    ] },
    'tk-rebuild': { t: 'Rebuild all leaderboards', p: 'Goes through every car, a few at a time, and rewrites its entry on each leaderboard it is on: its best for every mix of conditions and tyres, its track-relevant mods, make and model, driven wheels, and the board\'s count and top three. It changes no session or time, and is safe to run any time.' },
    'tk-retime-check': { t: 'Check sessions', p: 'A dry run: lists the sessions timed with an older version of the timing code that still have their saved readings, with the time each has now and the time it would get. It saves nothing. A time that would move by over 10% is flagged.' },
    'tk-retime': { t: 'Re-time out of date sessions', p: 'Reads each out-of-date session\'s saved readings again with the member\'s own settings and replaces its laps, times and figures, then rebuilds the leaderboards. It asks first. It skips sessions already on the current version, mapped drives, and sessions with no readings kept (the member uses Add the readings again).' },
    'tk-retime-big': { t: 'Also re-time big changes', p: 'A safety catch for Re-time. Off (the default): a session whose best time would move by more than 10% is held back and listed as not saved, because that usually means the wrong lines or laps were picked. On: those are saved too.' },
    'drive-wrap': { t: 'Driven wheels', p: 'Every vehicle that has sessions, and the wheels it drives (FWD, RWD or AWD) as worked out from its make, model and version, or as its owner set.', i: [
      ['Load vehicles', 'Lists them. Vehicles we cannot tell come first.'],
      ['Set or correct', 'Saved to the vehicle, stamped on all its sessions and put on its leaderboard rows.'],
      ['A whole model', 'A default for every vehicle of a model is set on the Vehicles panel.']
    ] },
    'dw-load': { t: 'Load vehicles', p: 'Lists every vehicle that has sessions with its driven wheels, the ones we cannot tell first. Setting one saves it to the vehicle, stamps all its sessions and refreshes its leaderboard rows.' },

    // ---------------------------------------------------------------- track-admin.html: content
    'copy-wrap': { t: 'Welcome text', p: 'What a visitor who is not signed in sees at the top of Track Sessions, and the upload tip.', i: [
      ['Heading, paragraph and tick list', 'Anything left blank keeps the built-in words.'],
      ['Show the tip', 'On: the upload tip shows under Add a session and on the Leaderboard. Members can fold it, but never hide it for good.'],
      ['Tip heading and text', 'Blank keeps the built-in words.'],
      ['Save', 'Keeps your wording.'],
      ['Use the built-in words', 'Clears your wording so the built-in text is used.']
    ] },
    'tc-tip-on': { t: 'Show the tip', p: 'On: the upload tip shows under Add a session and on the Leaderboard. Members can fold it to its heading but cannot hide it for good. Off: the tip is not shown anywhere.' },
    'tyres-wrap': { t: 'Tyres', p: 'The tyre makes, their models and the Width, Profile and Diameter choices offered in Track sessions.', i: [
      ['Starting list', 'data/tyres.json. Changes made here are stored on top of it and are live straight away.'],
      ['Model box', 'It suggests a make\'s models, but members can still type anything.'],
      ['Taking a make off', 'A make can be taken off the list.'],
      ['Sizes', 'A size list is only stored when it differs from the file\'s.']
    ] },
    'vehicles-wrap': { t: 'Vehicles', p: 'The makes and models offered when a car or bike is added, with their variants and driven wheels.', i: [
      ['Make type', 'A make is a car or a bike, and the same name can be both.'],
      ['Edit', 'Renames a make and lists its models. For each model: its variants (the Version choices in My Garage) and each one\'s own driven wheels, plus Remove model and Add a model.'],
      ['Required', 'The member must pick a version. Off, it is optional.'],
      ['Free text', 'Adds a Type it in choice so a member can type any version.'],
      ['Shown', 'A hidden make keeps its models but is left out of every list members pick from. Tesla is always offered.'],
      ['Remove and Restore', 'Removes a make from the file\'s list (Restore brings it back with its models and variants). A make you added is deleted for good.'],
      ['Default (driven wheels)', 'What a model\'s vehicles take unless the version says otherwise or the owner set it. Setting one updates the sessions of every vehicle of that model and its leaderboard rows.'],
      ['Use the built-in list', 'Drops your changes to a make.']
    ] },
    'cars-wrap': { t: 'Members\' cars', p: 'Every car and bike in members\' garages with its settings: type, make, model, version, year and driven wheels.', i: [
      ['Edit a row', 'Each drop-down offers the vehicle list\'s choices, with Type it in for anything else. Save writes them to the car, updates its sessions and refreshes its leaderboard rows, as if the owner had saved them.'],
      ['Cars with no model', 'They come first.'],
      ['Stale', 'A record with no owner, no live photo and no sessions is marked stale. Remove (or Remove all stale) deletes it. Nothing else is deleted.'],
      ['Find', 'Filters by owner or car.']
    ] },
    'mc-load': { t: 'Load cars', p: 'Lists every car and bike in the garages with its settings so you can check and change them. Nothing changes until you press Save on a row.' }
  };

  var SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8"/><path d="M12 17h.01"/></svg>';
  var pop = null, openFor = null;

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'help-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function close(refocus) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (openFor) { openFor.setAttribute('aria-expanded', 'false'); if (refocus) openFor.focus(); }
    openFor = null;
  }
  function place(btn) {
    var r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    pop.style.maxWidth = Math.min(380, vw - 16) + 'px';
    pop.style.left = '0px'; pop.style.top = '0px';
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    var below = r.bottom + 8, top = below + h <= vh - 8 ? below : Math.max(8, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function show(btn, id) {
    var entry = HELP[id];
    if (!entry) return;
    if (openFor === btn) { close(true); return; }
    close(false);
    var p = ensurePop();
    p.textContent = '';
    p.setAttribute('aria-label', 'Help: ' + entry.t);
    var x = el('button', 'help-close');
    x.type = 'button'; x.setAttribute('aria-label', 'Close help'); x.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.addEventListener('click', function () { close(true); });
    p.appendChild(x);
    p.appendChild(el('h4', 'help-title', entry.t));
    if (entry.p) p.appendChild(el('p', 'help-lead', entry.p));
    if (entry.i && entry.i.length) {
      var dl = el('dl', 'help-list');
      entry.i.forEach(function (row) { dl.appendChild(el('dt', '', row[0])); dl.appendChild(el('dd', '', row[1])); });
      p.appendChild(dl);
    }
    p.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openFor = btn;
    place(btn);
  }

  function make(id, entry) {
    var b = el('button', 'help-btn');
    b.type = 'button';
    b.setAttribute('data-help-for', id);
    // A name that does not repeat the control's own, so a search for a button by its name never lands on a help button.
    b.setAttribute('aria-label', 'What does this do?');
    b.setAttribute('aria-expanded', 'false');
    b.title = 'What does this do?';
    b.innerHTML = SVG;
    b.addEventListener('click', function (e) {
      // Inside a panel title: a click must not open or close the panel.
      e.preventDefault(); e.stopPropagation();
      show(b, id);
    });
    // In a panel title, Enter and Space on the button must not toggle the panel either.
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    return b;
  }

  function addButtons() {
    Object.keys(HELP).forEach(function (id) {
      var target = document.getElementById(id);
      if (!target || target.getAttribute('data-help-added')) return;
      var entry = HELP[id], btn = make(id, entry);
      if (target.tagName === 'DETAILS') {
        // At the right-hand end of the panel's title bar, clear of the title and its count.
        var bar = target.querySelector('summary');
        if (!bar || !bar.querySelector('.panel-title')) return;
        bar.classList.add('has-help');
        bar.appendChild(btn);
      } else {
        target.insertAdjacentElement('afterend', btn);
      }
      target.setAttribute('data-help-added', '1');
    });
  }

  document.addEventListener('click', function (e) {
    if (!pop || pop.hidden) return;
    if (e.target.closest('.help-pop') || e.target.closest('.help-btn')) return;
    close(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
  window.addEventListener('resize', function () { close(false); });
  window.addEventListener('scroll', function () { if (openFor) place(openFor); }, true);

  // Panels and controls the pages draw later get theirs too.
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(addButtons, 120); }
  function start() {
    addButtons();
    if (window.MutationObserver) new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.MT3UKAdminHelp = { help: HELP, refresh: addButtons };
})();
