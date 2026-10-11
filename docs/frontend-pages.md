# Front-end pages

- `/index.html` is the shared app shell. It keeps the hash router, API client, and Socket.IO session active during in-app navigation.
- Reusable layout markup and styles live in `public/components/`: `site-header.html` and `site-header.css` are shared across all entry pages, while `site-footer.html` and `site-footer.css` are used on the home screen. The shared shells link these styles after the global design system.
- Each screen is rendered by a module under `public/js/views/`. Shared styles live in `public/css/style.css`, with route-specific styles under `public/css/pages/`.
- Direct-link shells live as flat files under `public/pages/`: `home.html`, `auth.html`, `register.html`, `account.html`, `portal.html`, `portal-booking.html`, `my-queue.html`, `booking.html`, `employee.html`, `outside.html`, `room.html`, `registrar.html`, `admin.html`, `analytics.html`, and `feedback.html`.
- Old directory links such as `/pages/home/` redirect to `/pages/home.html`.

Use the regular app links (`#/...`) for in-app navigation so authentication, live queue updates, and return URLs continue to work. Ticket and feedback links include their real record IDs and are routed by the app.
