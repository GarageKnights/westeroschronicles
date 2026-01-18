(() => {
  "use strict";

  // ---- Constants ----

  const REGIONS = [
    "The North",
    "The Vale",
    "The Riverlands",
    "The Westerlands",
    "The Reach",
    "Dorne",
    "The Stormlands",
    "The Crownlands",
    "Beyond the Wall",
	"The Iron Islands",
	"Essos",
  ];

  const SETTINGS_PREFIX = "wc_settings_"; // + username

  let currentUser = null; // Supabase profile + local settings
  let stories = [];       // From Supabase
  let ravens = [];        // From Supabase
  let userVotesMap = {};  // story_id -> value
  let currentStoryForModal = null;
  let currentParentStoryId = null;

  // ---- Helpers ----

  function $(id) {
    return document.getElementById(id);
  }

  function loadJSON(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      if (!val) return fallback;
      return JSON.parse(val);
    } catch (e) {
      console.error("Failed to parse localStorage key", key, e);
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Failed to save localStorage key", key, e);
    }
  }

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }



  // ---- Story Tree Visualization ----

  function buildStoryTree(rootStory) {
    const tree = [];
    
    function traverse(story, depth = 0) {
      tree.push({ story, depth });
      const children = getChildrenOfStory(story.id);
      children.forEach(child => traverse(child, depth + 1));
    }
    
    traverse(rootStory);
    return tree;
  }

  function renderStoryTree(currentStoryId) {
    const currentStory = getStoryById(currentStoryId);
    if (!currentStory) return "";
    
    const root = getRootOfStory(currentStory);
    const tree = buildStoryTree(root);
    
    return tree.map(({ story, depth }) => {
      const isCurrent = story.id === currentStoryId;
      const indent = "  ".repeat(depth);
      const connector = depth === 0 ? "" : depth === 1 ? "├── " : "│   ".repeat(depth - 1) + "├── ";
      
      return `
        <div class="tree-item ${isCurrent ? 'tree-current' : ''}" data-story-id="${story.id}" style="padding-left: ${depth * 20}px;">
          <span class="tree-connector">${connector}</span>
          <span class="tree-title">${escapeHtml(story.title)}</span>
          <span class="tree-author">by ${escapeHtml(story.author)}</span>
          ${isCurrent ? '<span class="tree-badge">← You are here</span>' : ''}
        </div>
      `;
    }).join("");
  }

  function toggleStoryTree() {
    const container = document.querySelector(".story-tree-container");
    if (!container) return;
    
    if (container.style.display === "none") {
      container.style.display = "block";
    } else {
      container.style.display = "none";
    }
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getUserSettings(username) {
    return loadJSON(SETTINGS_PREFIX + username, { snow: false });
  }

  function saveUserSettings(username, settings) {
    saveJSON(SETTINGS_PREFIX + username, settings);
  }

  function getStoryById(id) {
    return stories.find((s) => s.id === id) || null;
  }

  function getChildrenOfStory(id) {
    return stories.filter((s) => s.parentId === id);
  }

  function getRootOfStory(story) {
    let current = story;
    while (current && current.parentId) {
      const parent = getStoryById(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current || story;
  }

  function getStoryScore(story) {
    return (story.upvotes || 0) - (story.downvotes || 0);
  }

  function mapStoryRow(row) {
    return {
      id: row.id,
      title: row.title,
      region: row.region,
      content: row.content,
      author: row.author_username,
      house: row.house,
      createdAt: row.created_at,
      upvotes: row.upvotes || 0,
      downvotes: row.downvotes || 0,
      parentId: row.parent_story_id,
    };
  }

  // ---- NEW: Toast notifications ----

  function showError(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--danger);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 1000;
      max-width: 300px;
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function showSuccess(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--accent-soft);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 1000;
      max-width: 300px;
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---- NEW: Better login check ----

  function requireLogin() {
    if (!currentUser) {
      showError("You must be signed in to do that. Please log in or create an account.");
      return false;
    }
    return true;
  }

  // ---- Domain enforcement ----

  function enforceDomain() {
    const warningEl = $("domainWarning");
    const hostname = window.location.hostname;

    const isFile = hostname === "";
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local");

    const allowedHost = "westeroschronicles.com";

    if (!isFile && !isLocal && hostname !== allowedHost) {
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }

  // ---- Snow effect ----

  let snowEnabled = false;
  let snowInitialized = false;

  function enableSnow() {
    if (snowInitialized) {
      snowEnabled = true;
      return;
    }
    snowInitialized = true;
    snowEnabled = true;

    const container = $("snowContainer");
    const flakes = 60;

    for (let i = 0; i < flakes; i++) {
      const span = document.createElement("span");
      span.className = "snowflake";
      span.textContent = "❄";
      span.style.left = Math.random() * 100 + "vw";
      span.style.animationDuration = 8 + Math.random() * 10 + "s";
      span.style.animationDelay = Math.random() * 10 + "s";
      span.style.setProperty(
        "--drift",
        (Math.random() * 60 - 30).toFixed(0) + "px"
      );
      container.appendChild(span);
    }
  }

  function disableSnow() {
    snowEnabled = false;
    const container = $("snowContainer");
    container.innerHTML = "";
    snowInitialized = false;
  }

  // ---- Login / Profile (Supabase) ----

  function applyHouseTheme(house) {
    const body = document.body;
    body.className = body.className
      .split(" ")
      .filter((c) => !c.startsWith("house-"))
      .join(" ");

    if (house) {
      const normalized = house.replace(/\s+/g, "-");
      body.classList.add(`house-${normalized}`);
    }
  }

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderUserStatus() {
    const statusEl = $("userStatus");
    if (!statusEl) return;

    if (!currentUser) {
      statusEl.innerHTML =
        '<span class="user-status-house">Guest of the realm</span>';
      return;
    }

    statusEl.innerHTML = `
      <div class="user-status-name">${escapeHtml(currentUser.username)}</div>
      <div class="user-status-house">${escapeHtml(currentUser.house || "")}</div>
    `;
  }

  function updateAuthLinks() {
    const linksEl = $("authLinks");
    if (!linksEl) return;

    if (!currentUser) {
      linksEl.innerHTML = `
        <a href="login.html">Sign in</a>
        <a href="signup.html">Create account</a>
      `;
    } else {
      linksEl.innerHTML = `
        <span class="auth-hello" style="color: var(--text-muted); font-size: 0.85rem;">Welcome, ${escapeHtml(
          currentUser.username
        )}</span>
      `;
    }
  }

  async function saveProfileBio(bio) {
    if (!currentUser) return;
    const { error } = await window.supabaseClient
      .from("profiles")
      .update({ bio })
      .eq("id", currentUser.id);
    if (error) throw error;
  }

  function initProfileUI() {
    const bioField = $("profileBio");
    const saveBtn = $("saveProfileBtn");
    const statusEl = $("profileStatus");
    const toggleSnowEl = $("toggleSnow");
    const logoutBtn = $("logoutBtn");

    if (currentUser && typeof currentUser.bio === "string") {
      bioField.value = currentUser.bio;
    }

    if (currentUser && currentUser.settings && currentUser.settings.snow) {
      toggleSnowEl.checked = true;
      enableSnow();
    }

    saveBtn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      const bio = bioField.value || "";
      currentUser.bio = bio;
      try {
        await saveProfileBio(bio);
        renderProfileCard();
        renderProfileStatsAndAchievements();
        showSuccess("Profile saved.");
      } catch (e) {
        console.error(e);
        showError("Error saving profile.");
      }
    });

    toggleSnowEl.addEventListener("change", () => {
      if (!currentUser) return;
      const isOn = toggleSnowEl.checked;
      if (!currentUser.settings) currentUser.settings = {};
      currentUser.settings.snow = isOn;
      saveUserSettings(currentUser.username, currentUser.settings);
      if (isOn) enableSnow();
      else disableSnow();
    });

    logoutBtn.addEventListener("click", async () => {
      if (currentUser && currentUser.username) {
        localStorage.removeItem(SETTINGS_PREFIX + currentUser.username);
      }
      await window.logoutAndRedirect();
    });

    renderProfileCard();
    renderProfileStatsAndAchievements();
  }

  function renderProfileCard() {
    if (!currentUser) return;
    const container = $("profileInfo");
    if (!container) return;

    const initials = (currentUser.username || "?")
      .split(/\s+/g)
      .map((p) => p[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();

    container.innerHTML = `
      <div class="profile-avatar" aria-hidden="true">
        ${escapeHtml(initials)}
      </div>
      <div class="profile-main">
        <p class="profile-name">${escapeHtml(currentUser.username)}</p>
        <p class="profile-house">${escapeHtml(currentUser.house || "")}</p>
        <p class="muted">${escapeHtml(currentUser.bio || "No bio yet.")}</p>
      </div>
    `;
  }

  function renderProfileStatsAndAchievements() {
    if (!currentUser) return;

    const statsEl = $("profileStats");
    const achievementsEl = $("profileAchievements");
    if (!statsEl || !achievementsEl) return;

    const userStories = stories.filter(
      (s) => s.author === currentUser.username
    );

    const userComments = 0;

    const totalScore = userStories.reduce(
      (sum, s) => sum + getStoryScore(s),
      0
    );

    statsEl.innerHTML = `
      <li>Chapters written: <strong>${userStories.length}</strong></li>
      <li>Comments made: <strong>${userComments}</strong></li>
      <li>Total chapter score: <strong>${totalScore}</strong></li>
    `;

    const achievements = [];

    if (userStories.length >= 1) {
      achievements.push({
        id: "first-quill",
        name: "First Quill",
        desc: "Submitted your first chapter.",
      });
    }
    if (userStories.length >= 5) {
      achievements.push({
        id: "seasoned-bard",
        name: "Seasoned Bard",
        desc: "Submitted five or more chapters.",
      });
    }
    if (totalScore >= 10) {
      achievements.push({
        id: "crowd-favorite",
        name: "Crowd Favorite",
        desc: "Earned a total score of 10 or more on your chapters.",
      });
    }
    if (
      userStories.some((s) => s.region === "The North") &&
      currentUser.house === "Stark"
    ) {
      achievements.push({
        id: "wolf-of-the-north",
        name: "Wolf of the North",
        desc: "A Stark writing tales of the North.",
      });
    }
    if (
      userStories.some((s) => s.region === "Beyond the Wall") &&
      currentUser.house === "Night's Watch"
    ) {
      achievements.push({
        id: "oath-kept",
        name: "Oath Kept",
        desc: "A brother of the Watch telling tales beyond the Wall.",
      });
    }

    if (!achievements.length) {
      achievementsEl.innerHTML =
        '<li class="achievement-item">No achievements yet. Begin your tale.</li>';
      return;
    }

    achievementsEl.innerHTML = achievements
      .map(
        (a) =>
          `<li class="achievement-item"><span>${escapeHtml(
            a.name
          )}</span> – ${escapeHtml(a.desc)}</li>`
      )
      .join("");
  }

  // ---- Tabs ----

  function initTabs() {
    const buttons = Array.from(document.querySelectorAll(".tabBtn"));
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;

        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        document
          .querySelectorAll(".tab")
          .forEach((sec) => sec.classList.remove("activeTab"));

        const target = $(tabId);
        if (target) {
          target.classList.add("activeTab");
        }

        if (tabId === "profile") {
          renderProfileCard();
          renderProfileStatsAndAchievements();
        } else if (tabId === "realm") {
          renderRealmMap();
        } else if (tabId === "stories") {
          renderStories();
        } else if (tabId === "ravens") {
          renderRavens();
        }
      });
    });
  }

  function switchToTab(tabId) {
    const btn = document.querySelector(`.tabBtn[data-tab="${tabId}"]`);
    if (btn) btn.click();
  }

  // ---- Stories (Supabase) - WITH LOADING STATES ----

  async function loadStoriesFromSupabase() {
    const listEl = $("storyList");
    const emptyEl = $("storiesEmpty");
    
    // Show loading
    if (listEl) {
      listEl.innerHTML = '<p class="muted" style="padding: 20px;">Loading stories from the realm...</p>';
    }
    if (emptyEl) {
      emptyEl.style.display = "none";
    }

    const { data, error } = await window.supabaseClient
      .from("stories")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading stories:", error);
      if (listEl) {
        listEl.innerHTML = '<p class="error-text" style="padding: 20px;">Failed to load stories. Please refresh the page.</p>';
      }
      stories = [];
      return;
    }
    
    stories = (data || []).map(mapStoryRow);
    renderStories();
  }

  async function loadUserVotesFromSupabase() {
    userVotesMap = {};
    if (!currentUser) return;

    const { data, error } = await window.supabaseClient
      .from("votes")
      .select("*")
      .eq("voter_profile_id", currentUser.id);

    if (error) {
      console.error("Error loading votes:", error);
      return;
    }

    (data || []).forEach((row) => {
      userVotesMap[row.story_id] = row.value;
    });
  }

  // ---- Quill Rich Text Editor ----
  let quillEditor = null;

  function initQuillEditor() {
    const editorContainer = document.getElementById('storyContent');
    if (!editorContainer) return;

    // Hide the textarea and create Quill container
    editorContainer.style.display = 'none';
    
    const quillContainer = document.createElement('div');
    quillContainer.id = 'quill-editor';
    editorContainer.parentNode.insertBefore(quillContainer, editorContainer.nextSibling);

    quillEditor = new Quill('#quill-editor', {
      theme: 'snow',
      placeholder: 'Write your chapter in the style of Westeros...',
      modules: {
        toolbar: [
          [{ 'header': [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          ['blockquote'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['clean']
        ]
      }
    });
  }


  function initStoriesUI() {
    const submitBtn = $("submitStoryBtn");
    const clearParentBtn = $("clearParentBtn");

    if (submitBtn) {
      submitBtn.addEventListener("click", handleSubmitStory);
    }
    if (clearParentBtn) {
      clearParentBtn.addEventListener("click", () => {
        currentParentStoryId = null;
        updateSubmitParentInfo();
      });
    }

    const searchEl = $("storiesSearch");
    const filterEl = $("storiesRegionFilter");
    const sortEl = $("storiesSort");

    if (searchEl) searchEl.addEventListener("input", renderStories);
    if (filterEl) filterEl.addEventListener("change", renderStories);
    if (sortEl) sortEl.addEventListener("change", renderStories);

    renderStories();
  }

  async function handleSubmitStory() {
    if (!requireLogin()) return;

    const title = ($("storyTitle").value || "").trim();
    const region = $("storyRegion").value || "";
    const content = quillEditor ? quillEditor.root.innerHTML.trim() : ($("storyContent").value || "").trim();

    // Check if content is empty (Quill returns <p><br></p> when empty)
    const isEmpty = !content || content === "<p><br></p>" || content === "<p></p>";

    if (!title || !content) {
      showError("Title and content are required.");
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("stories")
        .insert({
          title,
          region,
          content,
          author_profile_id: currentUser.id,
          author_username: currentUser.username,
          house: currentUser.house || null,
          parent_story_id: currentParentStoryId || null,
        })
        .select()
        .single();

      if (error) {
        console.error("Error inserting story:", error);
        showError("Error saving chapter.");
        return;
      }

      const newStory = mapStoryRow(data);
      // Create notification if continuing a story
      if (currentParentStoryId) {
        const parentStory = getStoryById(currentParentStoryId);
        if (parentStory && parentStory.authorId !== currentUser.id) {
          await createNotification(
            parentStory.authorId,
            "story_continued",
            "Someone continued your story!",
            `${currentUser.username} wrote "${title}" continuing from "${parentStory.title}"`,
            newStory.id
          );
        }
      }

      if (quillEditor) quillEditor.setContents([]);
      stories.unshift(newStory);

      $("storyTitle").value = "";
      $("storyRegion").value = "";
      $("storyContent").value = "";
      currentParentStoryId = null;
      updateSubmitParentInfo();

      showSuccess("Chapter saved to the realm!");

      renderStories();
      renderRealmMap();
      renderProfileStatsAndAchievements();
      switchToTab("stories");
    } catch (e) {
      console.error(e);
      showError("Error saving chapter. Please try again.");
    }
  }

  function updateSubmitParentInfo() {
    const info = $("submitParentInfo");
    const titleSpan = $("submitParentTitle");

    if (!info || !titleSpan) return;

    if (!currentParentStoryId) {
      info.hidden = true;
      titleSpan.textContent = "";
      return;
    }
    const story = getStoryById(currentParentStoryId);
    if (!story) {
      info.hidden = true;
      return;
    }

    info.hidden = false;
    titleSpan.textContent = story.title;
  }

  function renderStories() {
    const listEl = $("storyList");
    const emptyEl = $("storiesEmpty");
    if (!listEl || !emptyEl) return;

    const searchTerm = ($("storiesSearch")?.value || "").toLowerCase();
    const regionFilter = $("storiesRegionFilter")?.value || "";
    const sortBy = $("storiesSort")?.value || "newest";

    let filtered = [...stories];

    if (searchTerm) {
      filtered = filtered.filter((s) => {
        return (
          (s.title && s.title.toLowerCase().includes(searchTerm)) ||
          (s.author && s.author.toLowerCase().includes(searchTerm)) ||
          (s.region && s.region.toLowerCase().includes(searchTerm)) ||
          (s.content && s.content.toLowerCase().includes(searchTerm))
        );
      });
    }

    if (regionFilter) {
      filtered = filtered.filter((s) => s.region === regionFilter);
    }

    if (sortBy === "newest") {
      filtered.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    } else if (sortBy === "top") {
      filtered.sort((a, b) => getStoryScore(b) - getStoryScore(a));
    } else if (sortBy === "branched") {
      filtered.sort(
        (a, b) =>
          getChildrenOfStory(b.id).length - getChildrenOfStory(a.id).length
      );
    }

    if (!filtered.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";

    listEl.innerHTML = filtered
      .map((s) => {
        const plainText = stripHtml(s.content);
        const excerpt =
          plainText.length > 240
            ? plainText.slice(0, 240) + "…"
            : plainText;

        const score = getStoryScore(s);
        const branchCount = getChildrenOfStory(s.id).length;
        const userVote = userVotesMap[s.id] || 0;

        return `
        <article class="story-card" data-id="${s.id}">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="story-meta">
            by <strong class="author-link" data-author="${escapeHtml(s.author)}">${escapeHtml(s.author)}</strong>
            ${s.house ? ` of <em>${escapeHtml(s.house)}</em>` : ""}
            ${s.region ? ` • ${escapeHtml(s.region)}` : ""}
            ${s.createdAt ? ` • ${escapeHtml(formatDate(s.createdAt))}` : ""}
          </div>
          <p class="story-excerpt">${escapeHtml(excerpt)}</p>
          <div class="story-footer">
            <div class="story-actions">
              <button type="button" class="btn btn-primary btn-sm js-view-story">Read</button>
              <button type="button" class="btn btn-sm js-continue-story">Continue story</button>
            </div>
            <div class="story-actions">
              <span class="vote-chip">
                <button type="button" class="js-vote ${
                  userVote === 1 ? "active" : ""
                }" data-vote="up">+</button>
                <span>${score}</span>
                <button type="button" class="js-vote ${
                  userVote === -1 ? "active" : ""
                }" data-vote="down">-</button>
              </span>
              ${
                branchCount
                  ? `<span class="thread-chip">${branchCount} branched continuations</span>`
                  : ""
              }
            </div>
          </div>
        </article>
      `;
      })
      .join("");

    Array.from(listEl.querySelectorAll(".story-card")).forEach((card) => {
      const id = card.getAttribute("data-id");
      const story = getStoryById(id);
      if (!story) return;

      const viewBtn = card.querySelector(".js-view-story");
      const continueBtn = card.querySelector(".js-continue-story");
      const voteButtons = card.querySelectorAll(".js-vote");

      if (viewBtn) {
        viewBtn.addEventListener("click", () => openStoryModal(story.id));
      }
      if (continueBtn) {
        continueBtn.addEventListener("click", () => {
          if (!requireLogin()) return;
          currentParentStoryId = story.id;
          updateSubmitParentInfo();
          switchToTab("submit");
        });
      }

      voteButtons.forEach((btn) => {
        btn.addEventListener("click", () => handleVoteClick(story.id, btn));
      });
      // Add author link click handler
      const authorLink = card.querySelector(".author-link");
      if (authorLink) {
        authorLink.style.cursor = "pointer";
        authorLink.addEventListener("click", (e) => {
          e.stopPropagation();
          const author = authorLink.getAttribute("data-author");
          openUserProfileModal(author);
        });
      }
    });
  }

  async function handleVoteClick(storyId, btn) {
    if (!requireLogin()) return;
    
    const story = getStoryById(storyId);
    if (!story) return;

    const voteType = btn.getAttribute("data-vote");
    const prevVote = userVotesMap[storyId] || 0;
    let newVote = prevVote;

    if (voteType === "up") {
      newVote = prevVote === 1 ? 0 : 1;
    } else if (voteType === "down") {
      newVote = prevVote === -1 ? 0 : -1;
    }

    if (prevVote === 1) story.upvotes -= 1;
    if (prevVote === -1) story.downvotes -= 1;
    if (newVote === 1) story.upvotes += 1;
    if (newVote === -1) story.downvotes += 1;

    try {
      const { error: voteError } = await window.supabaseClient
        .from("votes")
        .upsert({
          story_id: storyId,
          voter_profile_id: currentUser.id,
          value: newVote,
        });

      if (voteError) {
        console.error("Error saving vote:", voteError);
        showError("Error saving vote.");
        return;
      }
      
      userVotesMap[storyId] = newVote;

      const { error: storyError } = await window.supabaseClient
        .from("stories")
        .update({
          upvotes: story.upvotes,
          downvotes: story.downvotes,
        })
        .eq("id", storyId);

      if (storyError) {
        console.error("Error updating story score:", storyError);
      }

      renderStories();
      renderProfileStatsAndAchievements();
    } catch (e) {
      console.error(e);
      showError("Error voting. Please try again.");
    }
  }

  // ---- Story modal & comments (Supabase) ----

  async function loadCommentsForStory(storyId) {
    const { data, error } = await window.supabaseClient
      .from("comments")
      .select("*")
      .eq("story_id", storyId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error loading comments:", error);
      return [];
    }
    return data || [];
  }

  function initStoryModal() {
    const modal = $("storyModal");
    const closeBtn = $("closeStoryModalBtn");

    if (!modal || !closeBtn) return;

    closeBtn.addEventListener("click", () => {
      modal.hidden = true;
      currentStoryForModal = null;
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.hidden = true;
        currentStoryForModal = null;
      }
    });

    // NEW: Close modal with Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) {
        modal.hidden = true;
        currentStoryForModal = null;
      }
    });
  }

  async function openStoryModal(storyId) {
    const story = getStoryById(storyId);
    if (!story) return;

    currentStoryForModal = story;
    const container = $("storyModalContent");
    const modal = $("storyModal");
    if (!container || !modal) return;

    const commentsRows = await loadCommentsForStory(storyId);
    const comments = commentsRows.map((c) => ({
      id: c.id,
      author: c.author_username,
      text: c.text,
      createdAt: c.created_at,
    }));

    const children = getChildrenOfStory(story.id);
    const root = getRootOfStory(story);
    const isRoot = root.id === story.id;

    container.innerHTML = `
      <h3 id="storyModalTitle" class="story-modal-title">${escapeHtml(
        story.title
      )}</h3>
      <div class="story-modal-meta">
        by <strong>${escapeHtml(story.author)}</strong>
        ${story.house ? ` of <em>${escapeHtml(story.house)}</em>` : ""}
        ${story.region ? ` • ${escapeHtml(story.region)}` : ""}
        ${story.createdAt ? ` • ${escapeHtml(formatDate(story.createdAt))}` : ""}
      </div>
      <div class="story-modal-body">${story.content}</div>

      <div class="story-modal-thread">
        <p class="muted">
          ${
            isRoot
              ? "Root of this thread."
              : `Part of thread starting from <strong>${escapeHtml(
                  root.title
                )}</strong>.`
          }
          ${
            children.length
              ? ` This chapter has <strong>${children.length}</strong> continuation(s).`
              : ""
          }
        </p>
      </div>
      <div class="story-tree-section">
        <button type="button" class="btn btn-sm js-toggle-tree">📊 View Story Tree</button>
        <div class="story-tree-container" style="display: none;">
          ${renderStoryTree(story.id)}
        </div>
      </div>


      <section class="story-modal-comments">
        <h4>Comments</h4>
        <ul class="comment-list" id="modalCommentList">
          ${
            comments.length
              ? comments
                  .map(
                    (c) => `
            <li>
              <div>${escapeHtml(c.text)}</div>
              <div class="comment-meta">
                by ${escapeHtml(c.author)} • ${escapeHtml(formatDate(c.createdAt))}
              </div>
            </li>`
                  )
                  .join("")
              : '<li class="muted">No comments yet. Be the first to speak.</li>'
          }
        </ul>
        
		<label class="field-label" for="modalCommentInput">Add comment</label>
        <textarea id="modalCommentInput" class="field" rows="3" placeholder="Leave a few words..."></textarea>
        <button id="modalCommentBtn" type="button" class="btn btn-primary">Post Comment</button>
      </section>
    `;

    modal.hidden = false;

    // Story tree toggle
    const treeToggleBtn = container.querySelector(".js-toggle-tree");
    if (treeToggleBtn) {
      treeToggleBtn.addEventListener("click", toggleStoryTree);
    }
    
    // Story tree item clicks
    container.querySelectorAll(".tree-item").forEach(item => {
      item.addEventListener("click", () => {
        const storyId = item.getAttribute("data-story-id");
        if (storyId) openStoryModal(storyId);
      });
    });

    const commentBtn = $("modalCommentBtn");
    if (commentBtn) {
      commentBtn.addEventListener("click", async () => {
        if (!requireLogin()) return;
        
        const text = ($("modalCommentInput").value || "").trim();
        if (!text) {
          showError("Comment cannot be empty.");
          return;
        }

        try {
          const { error } = await window.supabaseClient
            .from("comments")
            .insert({
              story_id: currentStoryForModal.id,
              author_profile_id: currentUser.id,
              author_username: currentUser.username,
              text,
            });

          if (error) {
            console.error("Error adding comment:", error);
            showError("Error posting comment.");
            return;
          }

          $("modalCommentInput").value = "";
          showSuccess("Comment posted!");
          await openStoryModal(currentStoryForModal.id);
        } catch (e) {
          console.error(e);
          showError("Error posting comment.");
        }
      });
    }
  }
  function setActiveRegion(region) {
    const grid = $("realmGrid");
    if (!grid) return;

    Array.from(grid.querySelectorAll(".region-card")).forEach((card) => {
      const cardRegion = card.getAttribute("data-region");
      card.classList.toggle("active", !!region && cardRegion === region);
    });
  }



  function setActiveMobileRegion(region) {
    const mobileList = document.querySelector(".realm-mobile-list");
    if (!mobileList) return;

    Array.from(mobileList.querySelectorAll(".realm-mobile-item")).forEach((item) => {
      const itemRegion = item.getAttribute("data-region");
      item.classList.toggle("active", !!region && itemRegion === region);
    });
  }

  // ---- User Profile Modal ----

  async function openUserProfileModal(username) {
    const modal = $("userProfileModal");
    const content = $("userProfileModalContent");
    if (!modal || !content) return;

    modal.removeAttribute("hidden");
    content.innerHTML = "<p>Loading profile...</p>";

    try {
      // Fetch user profile by username
      const { data: profile, error } = await window.supabaseClient
        .from("profiles")
        .select("*")
        .ilike("username", username)
        .maybeSingle();

      if (error || !profile) {
        content.innerHTML = "<p>User not found.</p>";
        return;
      }

      // Fetch user's stories
      const userStories = stories.filter(
        (s) => s.author.toLowerCase() === username.toLowerCase()
      );

      // Calculate stats
      const totalVotes = userStories.reduce((sum, s) => sum + getStoryScore(s), 0);
      const totalBranches = userStories.reduce(
        (sum, s) => sum + getChildrenOfStory(s.id).length,
        0
      );

      content.innerHTML = `
        <div class="user-profile-modal">
          <h2 id="userProfileModalTitle">${escapeHtml(profile.username)}</h2>
          ${profile.house ? `<p class="user-house">of ${escapeHtml(profile.house)}</p>` : ""}
          ${profile.bio ? `<p class="user-bio">${escapeHtml(profile.bio)}</p>` : "<p class=\"user-bio muted\">This maester has written no words about themselves.</p>"}
          
          ${currentUser && currentUser.username.toLowerCase() !== profile.username.toLowerCase() ? `<button class="btn btn-primary js-send-raven-to-user" type="button">Send Raven</button>` : ""}
          
          <div class="user-stats">
            <div class="stat-item">
              <span class="stat-value">${userStories.length}</span>
              <span class="stat-label">Chapters Written</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${totalVotes}</span>
              <span class="stat-label">Total Score</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${totalBranches}</span>
              <span class="stat-label">Stories Inspired</span>
            </div>
          </div>

          ${
            userStories.length > 0
              ? `
            <h3>Recent Chapters</h3>
            <div class="user-story-list">
              ${userStories
                .slice(0, 5)
                .map(
                  (s) => `
                <div class="user-story-item" data-story-id="${s.id}">
                  <h4>${escapeHtml(s.title)}</h4>
                  <p class="muted">${s.region || ""} • ${formatDate(s.createdAt)}</p>
                </div>
              `
                )
                .join("")}
            </div>
          `
              : "<p class=\"muted\">This maester has not yet penned any tales.</p>"
          }
        </div>
      `;

      // Add click handlers to story items
      if (userStories.length > 0) {
        content.querySelectorAll(".user-story-item").forEach((item) => {
          item.addEventListener("click", () => {
            const storyId = item.getAttribute("data-story-id");
            modal.hidden = true;
            openStoryModal(storyId);
          });
        });
      }

      // Add Send Raven button handler
      const sendRavenBtn = content.querySelector(".js-send-raven-to-user");
      if (sendRavenBtn) {
        sendRavenBtn.addEventListener("click", () => {
          modal.hidden = true;
          switchToTab("ravens");
          // Pre-fill the recipient field
          const recipientField = $("ravenRecipient");
          if (recipientField) {
            recipientField.value = profile.username;
            recipientField.focus();
          }
        });
      }
    } catch (e) {
      console.error("Error loading user profile:", e);
      content.innerHTML = "<p>Error loading profile.</p>";
    }
  }

  function initUserProfileModal() {
    const closeBtn = $("closeUserProfileModalBtn");
    const modal = $("userProfileModal");

    if (closeBtn && modal) {
      closeBtn.onclick = () => modal.hidden = true;
      modal.onclick = (e) => {
        if (e.target === modal) modal.hidden = true;
      };
    }
  }

  // ---- Realm map ----

  function renderRealmMap() {
    const grid = $("realmGrid");
    const filterEl = $("mapFilter");
    if (!grid || !filterEl) return;

    const regionStories = {};
    REGIONS.forEach((region) => {
      regionStories[region] = stories.filter((s) => s.region === region);
    });

    grid.innerHTML = REGIONS.map((region) => {
      const count = regionStories[region].length;
      const tagline =
        region === "The North"
          ? "Snow, wolves, and old gods."
          : region === "Dorne"
          ? "Sun, spears, and wine."
          : region === "Beyond the Wall"
          ? "Only the brave return."
          : region === "The Westerlands"
          ? "Gold in the hills."
          : region === "The Reach"
          ? "Fields of plenty."
          : region === "The Crownlands"
          ? "Where the throne casts a long shadow."
          : region === "The Vale"
          ? "Mountains and sky."
          : region === "The Riverlands"
          ? "Rivers run red with history."
          : region === "The Stormlands"
          ? "Thunder and stubborn kings."
          : region === "The Iron Islands"
          ? "The Ironborn hold fast to the Old Way."
          : region === "Essos"
          ? "The vast continent across the Narrow Sea."
		  : "";
      return `
        <article class="region-card" data-region="${region}" data-tagline="${escapeHtml(tagline)}">
          <h3 class="region-name">${region}<span class="region-count">(${count})</span></h3>
        </article>
      `;
    }).join("");


    // Create/update mobile region list
    let mobileList = grid.parentElement.querySelector(".realm-mobile-list");
    if (!mobileList) {
      mobileList = document.createElement("div");
      mobileList.className = "realm-mobile-list";
      grid.parentElement.insertBefore(mobileList, grid.nextSibling);
    }

    mobileList.innerHTML = REGIONS.map((region) => {
      const count = regionStories[region].length;
      return `
        <div class="realm-mobile-item" data-region="${region}">
          <span class="realm-mobile-name">${region}</span>
          <span class="realm-mobile-count">${count} ${count === 1 ? 'chapter' : 'chapters'}</span>
        </div>
      `;
    }).join("");

    // Add click handlers for mobile list items
    Array.from(mobileList.querySelectorAll(".realm-mobile-item")).forEach((item) => {
      const region = item.getAttribute("data-region");
      item.addEventListener("click", () => {
        filterEl.value = region;
        renderRealmStories();
        setActiveMobileRegion(region);
      });
    });

    // Clicking a region = choose that region in the dropdown + show stories + highlight
    Array.from(grid.querySelectorAll(".region-card")).forEach((card) => {
      const region = card.getAttribute("data-region");
      card.addEventListener("click", () => {
        filterEl.value = region;
        renderRealmStories();
        setActiveRegion(region);
      });
    });

    // Dropdown also controls the active highlight
    filterEl.onchange = () => {
      renderRealmStories();
      setActiveRegion(filterEl.value || "");
      setActiveMobileRegion(filterEl.value || "");
    };

    // Initial render
    renderRealmStories();
    setActiveRegion(filterEl.value || "");
    setActiveMobileRegion(filterEl.value || "");
  }


  function renderRealmStories() {
    const regionFilter = $("mapFilter")?.value || "";
    const listEl = $("realmStories");
    const emptyEl = $("realmEmpty");
    if (!listEl || !emptyEl) return;

    let filtered = stories;
    if (regionFilter) {
      filtered = stories.filter((s) => s.region === regionFilter);
    }

    if (!filtered.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";

    listEl.innerHTML = filtered
      .map((s) => {
        const plainText = stripHtml(s.content);
        const excerpt =
          plainText.length > 160
            ? plainText.slice(0, 160) + "…"
            : plainText;

        return `
        <article class="story-card" data-id="${s.id}">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="story-meta">
            by <strong class="author-link" data-author="${escapeHtml(s.author)}">${escapeHtml(s.author)}</strong>
            ${s.house ? ` of <em>${escapeHtml(s.house)}</em>` : ""}
            ${s.createdAt ? ` • ${escapeHtml(formatDate(s.createdAt))}` : ""}
          </div>
          <p class="story-excerpt">${escapeHtml(excerpt)}</p>
          <div class="story-footer">
            <div class="story-actions">
              <button class="btn btn-primary btn-sm js-view-story" type="button">Read</button>
            </div>
          </div>
        </article>
      `;
      })
      .join("");

    Array.from(listEl.querySelectorAll(".story-card")).forEach((card) => {
      const id = card.getAttribute("data-id");
      const story = getStoryById(id);
      if (!story) return;
      const viewBtn = card.querySelector(".js-view-story");
      if (viewBtn) {
        viewBtn.addEventListener("click", () => openStoryModal(story.id));
      }
      // Add author link click handler
      const authorLink = card.querySelector(".author-link");
      if (authorLink) {
        authorLink.style.cursor = "pointer";
        authorLink.addEventListener("click", (e) => {
          e.stopPropagation();
          const author = authorLink.getAttribute("data-author");
          openUserProfileModal(author);
        });
      }
    });
  }

  // ---- Ravens (Supabase) ----

  async function loadRavensFromSupabase() {
    if (!currentUser) {
      ravens = [];
      return;
    }

    const username = currentUser.username;

    const { data, error } = await window.supabaseClient
      .from("ravens")
      .select("*")
      .or(`to_username.eq.${username},from_username.eq.${username}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading ravens:", error);
      ravens = [];
    } else {
      ravens = data || [];
    }
  }

  function initRavensUI() {
    const btn = $("sendRavenBtn");
    if (btn) {
      btn.addEventListener("click", sendRaven);
    }
    renderRavens();
  }

  async function sendRaven() {
    if (!requireLogin()) return;

    const recipient = ($("ravenRecipient").value || "").trim();
    const message = ($("ravenMessage").value || "").trim();

    if (!recipient || !message) {
      showError("Recipient and message are required.");
      return;
    }

    try {
      const { error } = await window.supabaseClient
        .from("ravens")
        .insert({
          from_profile_id: currentUser.id,
          from_username: currentUser.username,
          to_username: recipient,
          body: message,
        });

      if (error) {
        console.error("Error sending raven:", error);
        showError("Error sending raven.");
        return;
      }

      $("ravenRecipient").value = "";
      $("ravenMessage").value = "";
      showSuccess("Raven sent to the realm!");

      await loadRavensFromSupabase();
      renderRavens();
    } catch (e) {
      console.error(e);
      showError("Error sending raven.");
    }
  }

  function renderRavens() {
    if (!currentUser) {
      const inboxEmptyEl = $("ravenInboxEmpty");
      const sentEmptyEl = $("ravenSentEmpty");
      const inboxEl = $("ravenInbox");
      const sentEl = $("ravenSent");
      if (inboxEl) inboxEl.innerHTML = "";
      if (sentEl) sentEl.innerHTML = "";
      if (inboxEmptyEl) inboxEmptyEl.style.display = "block";
      if (sentEmptyEl) sentEmptyEl.style.display = "block";
      return;
    }

    const inboxEl = $("ravenInbox");
    const sentEl = $("ravenSent");
    const inboxEmptyEl = $("ravenInboxEmpty");
    const sentEmptyEl = $("ravenSentEmpty");
    if (!inboxEl || !sentEl || !inboxEmptyEl || !sentEmptyEl) return;

    const inbox = ravens.filter((r) => r.to_username === currentUser.username);
    const sent = ravens.filter((r) => r.from_username === currentUser.username);

    if (!inbox.length) {
      inboxEl.innerHTML = "";
      inboxEmptyEl.style.display = "block";
    } else {
      inboxEmptyEl.style.display = "none";
      inboxEl.innerHTML = inbox
        .map(
          (r) => `
        <article class="raven-card">
          <div class="raven-meta">
            From <strong>${escapeHtml(r.from_username)}</strong>
            • ${escapeHtml(formatDate(r.created_at))}
          </div>
          <div class="raven-body">${escapeHtml(r.body)}</div>
        </article>
      `
        )
        .join("");
    }

    if (!sent.length) {
      sentEl.innerHTML = "";
      sentEmptyEl.style.display = "block";
    } else {
      sentEmptyEl.style.display = "none";
      sentEl.innerHTML = sent
        .map(
          (r) => `
        <article class="raven-card">
          <div class="raven-meta">
            To <strong>${escapeHtml(r.to_username)}</strong>
            • ${escapeHtml(formatDate(r.created_at))}
          </div>
          <div class="raven-body">${escapeHtml(r.body)}</div>
        </article>
      `
        )
        .join("");
    }
  }

  // ---- Post-login (really "post-init") ----

  async function initPostLogin() {
    await loadStoriesFromSupabase();
    await loadUserVotesFromSupabase();
    await loadRavensFromSupabase();

    initTabs();
    initStoriesUI();
    initQuillEditor();
    initStoryModal();
    initUserProfileModal();
    initProfileUI();
    initRavensUI();
    renderRealmMap();
  }

  // ---- Startup (no forced redirect) ----

  document.addEventListener("DOMContentLoaded", async () => {
    enforceDomain();

    let profile = null;

    try {
      const {
        data: { user },
        error,
      } = await window.supabaseClient.auth.getUser();

      if (error) {
        console.warn("Error getting auth user:", error.message);
      }

      if (user) {
        profile = await window.getCurrentProfile();
      }
    } catch (e) {
      console.error("Error checking auth state:", e);
    }

    if (profile) {
      const settings = getUserSettings(profile.username);
      currentUser = {
        ...profile,
        settings,
      };
      applyHouseTheme(currentUser.house);
    } else {
      currentUser = null; // guest mode
    }
    window.currentUser = currentUser;

    renderUserStatus();
    updateAuthLinks();

    await initPostLogin();
    if (window.initDiscussions) await window.initDiscussions();
    initNotifications();
  });

  // ---- Notifications System ----

  let notifications = [];
  let unreadCount = 0;

  async function loadNotifications() {
    if (!currentUser) return;

    try {
      const { data, error } = await window.supabaseClient
        .from("notifications")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Error loading notifications:", error);
        return;
      }

      notifications = data || [];
      unreadCount = notifications.filter(n => !n.read).length;
      updateNotificationUI();
    } catch (e) {
      console.error("Error loading notifications:", e);
    }
  }

  function updateNotificationUI() {
    const bell = $("notificationBell");
    const countEl = $("notificationCount");
    const listEl = $("notificationList");

    if (!bell || !countEl || !listEl) return;

    // Show/hide bell
    bell.style.display = currentUser ? "block" : "none";

    // Update count
    if (unreadCount > 0) {
      countEl.textContent = unreadCount > 99 ? "99+" : unreadCount;
      countEl.removeAttribute("hidden");
    } else {
      countEl.setAttribute("hidden", "");
    }

    // Render notifications
    if (notifications.length === 0) {
      listEl.innerHTML = '<p class="muted" style="padding: 20px; text-align: center;">No notifications yet</p>';
    } else {
      listEl.innerHTML = notifications.map(n => `
        <div class="notification-item ${n.read ? 'read' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
          <div class="notification-content">
            <strong>${escapeHtml(n.title)}</strong>
            <p>${escapeHtml(n.message)}</p>
            <span class="notification-time">${formatDate(n.created_at)}</span>
          </div>
          ${!n.read ? '<span class="unread-dot"></span>' : ''}
        </div>
      `).join("");

      // Add click handlers
      listEl.querySelectorAll(".notification-item").forEach(item => {
        item.addEventListener("click", async () => {
          const id = item.getAttribute("data-id");
          const link = item.getAttribute("data-link");
          
          await markNotificationRead(id);
          
          if (link) {
            // Close dropdown
            $("notificationDropdown").setAttribute("hidden", "");
            // Open the linked story
            openStoryModal(link);
          }
        });
      });
    }
  }

  async function markNotificationRead(notificationId) {
    const notification = notifications.find(n => n.id === notificationId);
    if (!notification || notification.read) return;

    notification.read = true;
    unreadCount = Math.max(0, unreadCount - 1);
    updateNotificationUI();

    try {
      await window.supabaseClient
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId);
    } catch (e) {
      console.error("Error marking notification read:", e);
    }
  }

  async function markAllNotificationsRead() {
    if (unreadCount === 0) return;

    notifications.forEach(n => n.read = true);
    unreadCount = 0;
    updateNotificationUI();

    try {
      await window.supabaseClient
        .from("notifications")
        .update({ read: true })
        .eq("user_id", currentUser.id)
        .eq("read", false);
    } catch (e) {
      console.error("Error marking all read:", e);
    }
  }

  async function createNotification(userId, type, title, message, link = null) {
    try {
      await window.supabaseClient
        .from("notifications")
        .insert({
          user_id: userId,
          type,
          title,
          message,
          link
        });
    } catch (e) {
      console.error("Error creating notification:", e);
    }
  }

  function initNotifications() {
    const bellBtn = document.querySelector(".bell-btn");
    const dropdown = $("notificationDropdown");
    const markAllBtn = $("markAllReadBtn");

    if (bellBtn && dropdown) {
      bellBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = dropdown.hasAttribute("hidden");
        if (isHidden) {
          dropdown.removeAttribute("hidden");
        } else {
          dropdown.setAttribute("hidden", "");
        }
      });

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (!dropdown.hasAttribute("hidden") && !dropdown.contains(e.target) && e.target !== bellBtn) {
          dropdown.setAttribute("hidden", "");
        }
      });
    }

    if (markAllBtn) {
      markAllBtn.addEventListener("click", markAllNotificationsRead);
    }

    // Load notifications periodically
    if (currentUser) {
      loadNotifications();
      setInterval(loadNotifications, 30000); // Every 30 seconds
    }
  }

})();