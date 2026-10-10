// Feedback submission (from a served ticket, or by ticket code)
import { api } from '../api.js';
import { toast, escapeHtml, initials } from '../ui.js';

export async function renderFeedback(view, ticketId) {
  if (!api.user) { location.hash = `#/login?redirect=${encodeURIComponent('#/feedback' + (ticketId ? `/${ticketId}` : ''))}`; return; }

  let ticket = null;
  let ticketError = '';
  if (ticketId) {
    const data = await api.get(`/api/tickets/${ticketId}`).catch(() => null);
    if (!data) {
      ticketError = 'Ticket not found or already rated.';
    } else {
      ticket = data.ticket;
      if (ticket.status !== 'served') {
        ticketError = 'Feedback is available after your visit is completed.';
        ticket = null;
      } else if (data.feedback) {
        ticketError = 'You already submitted feedback for this ticket.';
        ticket = null;
      }
    }
  }

  let rating = 5;

  view.innerHTML = `
    <div class="auth-wrap" style="max-width:520px">
      <div class="card auth-card">
        <h1>Share your experience</h1>
        <div class="sub">Your feedback helps the university improve service quality.</div>

        ${ticket ? `
          <div class="card card-pad" style="background:var(--bg);margin-bottom:16px">
            <div class="flex-between">
              <div>
                <b>${escapeHtml(ticket.serviceName)}</b>
                <div class="small muted mono">${escapeHtml(ticket.code)} · ${escapeHtml(ticket.building)}</div>
              </div>
              <span class="badge success">Served</span>
            </div>
          </div>
          <form id="fbForm">
            <div class="field">
              <label>How was the service?</label>
              <div class="rating-input" id="ratingInput">
                ${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="${i <= rating ? 'on' : ''}">★</button>`).join('')}
              </div>
            </div>
            <div class="field">
              <label for="comment">Comment (optional)</label>
              <textarea class="textarea" id="comment" maxlength="1000" placeholder="What went well? What can we improve?"></textarea>
            </div>
            <button class="btn primary btn-block lg" type="submit">Submit feedback</button>
          </form>` : `
          <div class="alert-banner" style="margin-bottom:14px">
            <span>ℹ️</span><div>${escapeHtml(ticketError || 'Enter a served ticket code to rate your visit.')}</div>
          </div>
          <form id="lookupForm">
            <div class="field">
              <label for="code">Ticket code</label>
              <input class="input mono" id="code" placeholder="e.g. REG-042" />
            </div>
            <button class="btn ghost btn-block" type="submit">Look up ticket</button>
          </form>`}
      </div>
    </div>`;

  const ratingInput = view.querySelector('#ratingInput');
  if (ratingInput) {
    ratingInput.querySelectorAll('[data-star]').forEach((btn) => {
      btn.onclick = () => {
        rating = parseInt(btn.dataset.star, 10);
        ratingInput.querySelectorAll('[data-star]').forEach((b) => {
          b.classList.toggle('on', parseInt(b.dataset.star, 10) <= rating);
        });
      };
    });
    view.querySelector('#fbForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.post(`/api/tickets/${ticketId}/feedback`, {
          rating,
          comment: view.querySelector('#comment').value.trim(),
        });
        toast('Thank you! 💙', 'Feedback submitted successfully', 'success');
        location.hash = '#/portal';
      } catch (err) {
        toast('Failed', err.message, 'error');
      }
    };
  }

  const lookup = view.querySelector('#lookupForm');
  if (lookup) {
    lookup.onsubmit = async (e) => {
      e.preventDefault();
      const code = view.querySelector('#code').value.trim().toUpperCase();
      // find ticket by code via mine list
      try {
        const { tickets } = await api.get('/api/tickets/mine');
        const found = tickets.find((t) => t.code.toUpperCase() === code);
        if (!found) { toast('Not found', 'No ticket with that code in your account', 'warn'); return; }
        location.hash = `#/feedback/${found._id}`;
      } catch (err) {
        toast('Lookup failed', err.message, 'error');
      }
    };
  }
}
