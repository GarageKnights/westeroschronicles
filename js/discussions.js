// discussions.js - Community discussions feature

(() => {
  "use strict";

  let discussions = [];
  let discussionVotes = {};
  let newDiscussionQuill = null;
  let replyQuills = {};

  const CATEGORIES = ["General", "Theories", "Writing Help", "Character Analysis", "Site Feedback"];

  // ---- Load Discussions ----

  async function loadDiscussionsFromSupabase() {
    try {
      const { data, error } = await window.supabaseClient
        .from("discussions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading discussions:", error);
        return;
      }

      discussions = data || [];
      await loadDiscussionVotes();
      renderDiscussions();
    } catch (e) {
      console.error("Error loading discussions:", e);
    }
  }

  async function loadDiscussionVotes() {
    if (!window.currentUser) {
      discussionVotes = {};
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("discussion_votes")
        .select("*")
        .eq("user_id", window.currentUser.id);

      if (error) {
        console.error("Error loading votes:", error);
        return;
      }

      discussionVotes = {};
      (data || []).forEach(row => {
        discussionVotes[row.discussion_id] = row.value;
      });
    } catch (e) {
      console.error("Error loading votes:", e);
    }
  }

  // ---- Render Discussions ----

  function renderDiscussions() {
    const listEl = document.getElementById("discussionsList");
    const emptyEl = document.getElementById("discussionsEmpty");
    const categoryFilter = document.getElementById("discussionsCategory")?.value || "";
    const sort = document.getElementById("discussionsSort")?.value || "hot";

    if (!listEl || !emptyEl) return;

    let filtered = discussions;
    if (categoryFilter) {
      filtered = discussions.filter(d => d.category === categoryFilter);
    }

    // Sort
    if (sort === "new") {
      filtered = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sort === "top") {
      filtered = [...filtered].sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else { // hot
      filtered = [...filtered].sort((a, b) => {
        const scoreA = (a.upvotes - a.downvotes) / (Math.max(1, (Date.now() - new Date(a.created_at)) / 86400000));
        const scoreB = (b.upvotes - b.downvotes) / (Math.max(1, (Date.now() - new Date(b.created_at)) / 86400000));
        return scoreB - scoreA;
      });
    }

    if (!filtered.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";

    listEl.innerHTML = filtered.map(d => {
      const score = d.upvotes - d.downvotes;
      const userVote = discussionVotes[d.id] || 0;

      return `
        <article class="discussion-card" data-id="${d.id}">
          <div class="discussion-vote">
            <button type="button" class="vote-btn ${userVote === 1 ? 'active' : ''}" data-vote="up">▲</button>
            <span class="vote-score">${score}</span>
            <button type="button" class="vote-btn ${userVote === -1 ? 'active' : ''}" data-vote="down">▼</button>
          </div>
          <div class="discussion-content">
            <h3 class="discussion-title">${escapeHtml(d.title)}</h3>
            <div class="discussion-meta">
              <span class="discussion-category">${escapeHtml(d.category)}</span>
              <span>by <strong class="author-link" data-author="${escapeHtml(d.author_username)}">${escapeHtml(d.author_username)}</strong></span>
              <span>${formatDate(d.created_at)}</span>
            </div>
          </div>
        </article>
      `;
    }).join("");

    // Add click handlers
    listEl.querySelectorAll(".discussion-card").forEach(card => {
      const id = card.getAttribute("data-id");
      
      card.querySelector(".discussion-content").addEventListener("click", () => {
        openDiscussionModal(id);
      });

      card.querySelectorAll(".vote-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          handleDiscussionVote(id, btn.getAttribute("data-vote"));
        });
      });

      const authorLink = card.querySelector(".author-link");
      if (authorLink && window.openUserProfileModal) {
        authorLink.addEventListener("click", (e) => {
          e.stopPropagation();
          window.openUserProfileModal(authorLink.getAttribute("data-author"));
        });
      }
    });
  }

  // ---- Discussion Voting ----

  async function handleDiscussionVote(discussionId, voteType) {
    if (!window.currentUser) {
      alert("Please log in to vote");
      return;
    }

    const discussion = discussions.find(d => d.id === discussionId);
    if (!discussion) return;

    const prevVote = discussionVotes[discussionId] || 0;
    const newVote = voteType === "up" ? (prevVote === 1 ? 0 : 1) : (prevVote === -1 ? 0 : -1);

    // Update UI optimistically
    if (prevVote === 1) discussion.upvotes -= 1;
    if (prevVote === -1) discussion.downvotes -= 1;
    if (newVote === 1) discussion.upvotes += 1;
    if (newVote === -1) discussion.downvotes += 1;

    discussionVotes[discussionId] = newVote;
    renderDiscussions();

    // Update database
    try {
      if (newVote === 0) {
        await window.supabaseClient
          .from("discussion_votes")
          .delete()
          .eq("user_id", window.currentUser.id)
          .eq("discussion_id", discussionId);
      } else {
        await window.supabaseClient
          .from("discussion_votes")
          .upsert({
            user_id: window.currentUser.id,
            discussion_id: discussionId,
            value: newVote
          });
      }

      await window.supabaseClient
        .from("discussions")
        .update({ upvotes: discussion.upvotes, downvotes: discussion.downvotes })
        .eq("id", discussionId);
    } catch (e) {
      console.error("Error voting:", e);
    }
  }

  // ---- Open Discussion Modal ----

  async function openDiscussionModal(discussionId) {
    const modal = document.getElementById("discussionModal");
    const content = document.getElementById("discussionModalContent");
    if (!modal || !content) return;

    modal.removeAttribute("hidden");
    content.innerHTML = "<p>Loading...</p>";

    const discussion = discussions.find(d => d.id === discussionId);
    if (!discussion) return;

    // Load replies
    const { data: repliesData, error } = await window.supabaseClient
      .from("discussion_replies")
      .select("*")
      .eq("discussion_id", discussionId)
      .order("created_at", { ascending: true });

    const replies = repliesData || [];

    const score = discussion.upvotes - discussion.downvotes;
    const userVote = discussionVotes[discussionId] || 0;

    content.innerHTML = `
      <div class="discussion-detail">
        <div class="discussion-detail-header">
          <div class="discussion-vote-large">
            <button type="button" class="vote-btn-lg ${userVote === 1 ? 'active' : ''}" data-vote="up">▲</button>
            <span class="vote-score-lg">${score}</span>
            <button type="button" class="vote-btn-lg ${userVote === -1 ? 'active' : ''}" data-vote="down">▼</button>
          </div>
          <div>
            <h2>${escapeHtml(discussion.title)}</h2>
            <div class="discussion-meta">
              <span class="discussion-category">${escapeHtml(discussion.category)}</span>
              <span>by <strong class="author-link" data-author="${escapeHtml(discussion.author_username)}">${escapeHtml(discussion.author_username)}</strong></span>
              <span>${formatDate(discussion.created_at)}</span>
            </div>
          </div>
        </div>
        
        <div class="discussion-body">${discussion.content}</div>

        <div class="discussion-reply-form">
          <h4>Add a Reply</h4>
          <div id="replyEditor"></div>
          <button id="submitReplyBtn" class="btn btn-primary" type="button">Post Reply</button>
        </div>

        <div class="discussion-replies">
          <h4>${replies.length} ${replies.length === 1 ? 'Reply' : 'Replies'}</h4>
          <div id="repliesList">
            ${renderReplies(replies)}
          </div>
        </div>
      </div>
    `;

    // Initialize reply editor
    const replyEditorContainer = content.querySelector("#replyEditor");
    const replyQuill = new Quill(replyEditorContainer, {
      theme: 'snow',
      placeholder: 'Share your thoughts...',
      modules: {
        toolbar: [['bold', 'italic'], ['blockquote'], [{ 'list': 'bullet' }]]
      }
    });

    // Vote handlers
    content.querySelectorAll(".vote-btn-lg").forEach(btn => {
      btn.addEventListener("click", () => {
        handleDiscussionVote(discussionId, btn.getAttribute("data-vote"));
      });
    });

    // Reply submit
    content.querySelector("#submitReplyBtn").addEventListener("click", async () => {
      if (!window.currentUser) {
        alert("Please log in to reply");
        return;
      }

      const replyContent = replyQuill.root.innerHTML.trim();
      if (!replyContent || replyContent === "<p><br></p>") {
        alert("Reply cannot be empty");
        return;
      }

      try {
        const { error } = await window.supabaseClient
          .from("discussion_replies")
          .insert({
            discussion_id: discussionId,
            author_id: window.currentUser.id,
            author_username: window.currentUser.username,
            content: replyContent
          });

        if (error) {
          console.error("Error posting reply:", error);
          alert("Error posting reply");
          return;
        }

        replyQuill.setContents([]);
        openDiscussionModal(discussionId); // Reload
      } catch (e) {
        console.error("Error:", e);
      }
    });

    // Author link
    const authorLink = content.querySelector(".author-link");
    if (authorLink && window.openUserProfileModal) {
      authorLink.addEventListener("click", () => {
        window.openUserProfileModal(authorLink.getAttribute("data-author"));
      });
    }
  }

  function renderReplies(replies) {
    if (!replies.length) return '<p class="muted">No replies yet.</p>';

    return replies.map(r => `
      <div class="reply">
        <div class="reply-header">
          <strong class="author-link" data-author="${escapeHtml(r.author_username)}">${escapeHtml(r.author_username)}</strong>
          <span class="reply-date">${formatDate(r.created_at)}</span>
        </div>
        <div class="reply-content">${r.content}</div>
      </div>
    `).join("");
  }

  // ---- New Discussion Modal ----

  function initNewDiscussionModal() {
    const btn = document.getElementById("newDiscussionBtn");
    const modal = document.getElementById("newDiscussionModal");
    const closeBtn = document.getElementById("closeNewDiscussionModalBtn");
    const submitBtn = document.getElementById("submitDiscussionBtn");

    if (!btn || !modal) return;

    btn.addEventListener("click", () => {
      if (!window.currentUser) {
        alert("Please log in to start a discussion");
        return;
      }
      modal.removeAttribute("hidden");
      
      if (!newDiscussionQuill) {
        newDiscussionQuill = new Quill('#newDiscussionEditor', {
          theme: 'snow',
          placeholder: 'What do you want to discuss?',
          modules: {
            toolbar: [
              [{ 'header': [2, 3, false] }],
              ['bold', 'italic'],
              ['blockquote'],
              [{ 'list': 'bullet' }]
            ]
          }
        });
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        modal.setAttribute("hidden", "");
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        const title = document.getElementById("newDiscussionTitle").value.trim();
        const category = document.getElementById("newDiscussionCategory").value;
        const content = newDiscussionQuill.root.innerHTML.trim();

        if (!title || !content || content === "<p><br></p>") {
          alert("Title and content are required");
          return;
        }

        try {
          const { error } = await window.supabaseClient
            .from("discussions")
            .insert({
              author_id: window.currentUser.id,
              author_username: window.currentUser.username,
              title,
              content,
              category
            });

          if (error) {
            console.error("Error creating discussion:", error);
            alert("Error creating discussion");
            return;
          }

          document.getElementById("newDiscussionTitle").value = "";
          newDiscussionQuill.setContents([]);
          modal.setAttribute("hidden", "");
          await loadDiscussionsFromSupabase();
        } catch (e) {
          console.error("Error:", e);
        }
      });
    }
  }

  function initDiscussionModal() {
    const modal = document.getElementById("discussionModal");
    const closeBtn = document.getElementById("closeDiscussionModalBtn");

    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => modal.setAttribute("hidden", ""));
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.setAttribute("hidden", "");
      });
    }
  }

  function initDiscussionsFilters() {
    const categoryFilter = document.getElementById("discussionsCategory");
    const sortSelect = document.getElementById("discussionsSort");

    if (categoryFilter) categoryFilter.addEventListener("change", renderDiscussions);
    if (sortSelect) sortSelect.addEventListener("change", renderDiscussions);
  }

  // ---- Helper Functions ----

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // ---- Initialize ----

  window.initDiscussions = async function() {
    await loadDiscussionsFromSupabase();
    initNewDiscussionModal();
    initDiscussionModal();
    initDiscussionsFilters();
  };

})();