(() => {
  "use strict";

  // ---- Constants & storage keys ----

  const STORAGE_KEYS = {
    PROFILE: "wc_profile",
    STORIES: "wc_stories",
    RAVENS: "wc_ravens",
    VOTES_PREFIX: "wc_votes_", // + username
  };

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
  ];

  let currentUser = null;
  let stories = [];
  let ravens = [];
  let currentStoryForModal = null;
  let currentParentStoryId = null;

  // ---- Helpers ----

  function $(id) {
    return document.getElementById(id);
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  function getUserVotesKey(username) {
    return STORAGE_KEYS.VOTES_PREFIX + username;
  }

  function getUserVotes(username) {
    return loadJSON(getUserVotesKey(username), {});
  }

  function saveUserVotes(username, votes) {
    saveJSON(getUserVotesKey(username), votes);
  }

  function cloneStoriesSorted() {
    return [...stories];
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

  // ---- Login / Profile ----

  function applyHouseTheme(house) {
    const body = document.body;
    // Clear previous house-* classes
    body.className = body.className
      .split(" ")
      .filter((c) => !c.startsWith("house-"))
      .join(" ");

    if (house) {
      const normalized = house.replace(/\s+/g, "-");
      body.classList.add(`house-${normalized}`);
    }
  }

  function renderUserStatus() {
    const statusEl = $("userStatus");
    if (!currentUser) {
      statusEl.innerHTML = '<span class="user-status-house">Not logged in</span>';
      return;
    }

    statusEl.innerHTML = `
      <div class="user-status-name">${escapeHtml(currentUser.username)}</div>
      <div class="user-status-house">${escapeHtml(currentUser.house || "")}</div>
    `;
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

  function initLoginOverlay() {
    const overlay = $("loginOverlay");
    const usernameInput = $("usernameInput");
    const houseSelect = $("houseSelect");
    const createBtn = $("createProfileBtn");
    const errorEl = $("loginError");

    createBtn.addEventListener("click", () => {
      const name = (usernameInput.value || "").trim();
      const house = houseSelect.value || "";
      if (!name || name.length < 2) {
        errorEl.textContent = "Choose a name of at least 2 characters.";
        return;
      }
      if (!house) {
        errorEl.textContent = "Choose a house to swear your banner to.";
        return;
      }

      const profile = {
        username: name,
        house,
        bio: "",
        settings: {
          snow: false,
        },
      };

      currentUser = profile;
      saveJSON(STORAGE_KEYS.PROFILE, profile);
      applyHouseTheme(house);
      renderUserStatus();
      overlay.style.display = "none";
      initPostLogin();
    });
  }

  function loadExistingProfile() {
    const profile = loadJSON(STORAGE_KEYS.PROFILE, null);
    if (!profile || !profile.username) {
      $("loginOverlay").style.display = "flex";
      return false;
    }
    currentUser = profile;
    applyHouseTheme(profile.house);
    renderUserStatus();
    $("loginOverlay").style.display = "none";

    // Snow
    if (profile.settings && profile.settings.snow) {
      $("toggleSnow").checked = true;
      enableSnow();
    }
    return true;
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

    saveBtn.addEventListener("click", () => {
      const bio = bioField.value || "";
      currentUser.bio = bio;
      saveJSON(STORAGE_KEYS.PROFILE, currentUser);
      renderProfileCard();
      renderProfileStatsAndAchievements();
      statusEl.textContent = "Profile saved.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    });

    toggleSnowEl.addEventListener("change", () => {
      const isOn = toggleSnowEl.checked;
      if (!currentUser.settings) currentUser.settings = {};
      currentUser.settings.snow = isOn;
      saveJSON(STORAGE_KEYS.PROFILE, currentUser);
      if (isOn) {
        enableSnow();
      } else {
        disableSnow();
      }
    });

    logoutBtn.addEventListener("click", () => {
      if (!confirm("This will clear your persona and local data. Continue?")) {
        return;
      }
      localStorage.removeItem(STORAGE_KEYS.PROFILE);
      // keep stories & ravens so other personas can see them, but clear votes for this user
      if (currentUser && currentUser.username) {
        localStorage.removeItem(getUserVotesKey(currentUser.username));
      }
      currentUser = null;
      window.location.reload();
    });

    renderProfileCard();
    renderProfileStatsAndAchievements();
  }

  function renderProfileCard() {
    if (!currentUser) return;
    const container = $("profileInfo");
    const initials = (currentUser.username || "?")
      .split(/\s+/)
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

    const userStories = stories.filter(
      (s) => s.author === currentUser.username
    );
    const userComments = stories.reduce((count, s) => {
      const comments = s.comments || [];
      return (
        count + comments.filter((c) => c.author === currentUser.username).length
      );
    }, 0);

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

  // ---- Stories ----

  function loadStories() {
    stories = loadJSON(STORAGE_KEYS.STORIES, []);
  }

  function saveStories() {
    saveJSON(STORAGE_KEYS.STORIES, stories);
  }

  function initStoriesUI() {
    const submitBtn = $("submitStoryBtn");
    const clearParentBtn = $("clearParentBtn");

    submitBtn.addEventListener("click", handleSubmitStory);
    clearParentBtn.addEventListener("click", () => {
      currentParentStoryId = null;
      updateSubmitParentInfo();
    });

    $("storiesSearch").addEventListener("input", renderStories);
    $("storiesRegionFilter").addEventListener("change", renderStories);
    $("storiesSort").addEventListener("change", renderStories);

    renderStories();
  }

  function handleSubmitStory() {
    if (!currentUser) return;

    const title = ($("storyTitle").value || "").trim();
    const region = $("storyRegion").value || "";
    const content = ($("storyContent").value || "").trim();
    const statusEl = $("submitStatus");

    if (!title || !content) {
      statusEl.textContent = "Title and content are required.";
      return;
    }

    const story = {
      id: generateId(),
      title,
      region,
      content,
      author: currentUser.username,
      house: currentUser.house || "",
      createdAt: new Date().toISOString(),
      upvotes: 0,
      downvotes: 0,
      parentId: currentParentStoryId || null,
      comments: [],
    };

    stories.push(story);
    saveStories();

    $("storyTitle").value = "";
    $("storyRegion").value = "";
    $("storyContent").value = "";
    currentParentStoryId = null;
    updateSubmitParentInfo();

    statusEl.textContent = "Chapter saved locally.";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2000);

    renderStories();
    renderRealmMap();
    renderProfileStatsAndAchievements();
    switchToTab("stories");
  }

  function updateSubmitParentInfo() {
    const info = $("submitParentInfo");
    const titleSpan = $("submitParentTitle");

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

    const searchTerm = ($("storiesSearch").value || "").toLowerCase();
    const regionFilter = $("storiesRegionFilter").value || "";
    const sortBy = $("storiesSort").value || "newest";

    let filtered = cloneStoriesSorted();

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
        (a, b) => getChildrenOfStory(b.id).length - getChildrenOfStory(a.id).length
      );
    }

    if (!filtered.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";

    const userVotes = currentUser
      ? getUserVotes(currentUser.username)
      : {};

    listEl.innerHTML = filtered
      .map((s) => {
        const excerpt =
          s.content.length > 240
            ? s.content.slice(0, 240) + "…"
            : s.content;

        const score = getStoryScore(s);
        const branchCount = getChildrenOfStory(s.id).length;
        const userVote = userVotes[s.id] || 0;

        return `
        <article class="story-card" data-id="${s.id}">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="story-meta">
            by <strong>${escapeHtml(s.author)}</strong>
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
                <button type="button" class="js-vote" data-vote="up" ${
                  userVote === 1 ? "aria-pressed='true' class='active'" : ""
                }>+</button>
                <span>${score}</span>
                <button type="button" class="js-vote" data-vote="down" ${
                  userVote === -1 ? "aria-pressed='true' class='active'" : ""
                }>-</button>
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

    // Attach events
    Array.from(listEl.querySelectorAll(".story-card")).forEach((card) => {
      const id = card.getAttribute("data-id");
      const story = getStoryById(id);
      if (!story) return;

      const viewBtn = card.querySelector(".js-view-story");
      const continueBtn = card.querySelector(".js-continue-story");
      const voteButtons = card.querySelectorAll(".js-vote");

      viewBtn.addEventListener("click", () => openStoryModal(story.id));
      continueBtn.addEventListener("click", () => {
        currentParentStoryId = story.id;
        updateSubmitParentInfo();
        switchToTab("submit");
      });

      voteButtons.forEach((btn) => {
        btn.addEventListener("click", () => handleVoteClick(story.id, btn));
      });
    });
  }

  function handleVoteClick(storyId, btn) {
    if (!currentUser) return;
    const voteType = btn.getAttribute("data-vote");
    const story = getStoryById(storyId);
    if (!story) return;

    const votes = getUserVotes(currentUser.username);
    const prevVote = votes[storyId] || 0;
    let newVote = prevVote;

    if (voteType === "up") {
      newVote = prevVote === 1 ? 0 : 1;
    } else if (voteType === "down") {
      newVote = prevVote === -1 ? 0 : -1;
    }

    // Adjust counts based on change
    if (prevVote === 1) story.upvotes -= 1;
    if (prevVote === -1) story.downvotes -= 1;
    if (newVote === 1) story.upvotes += 1;
    if (newVote === -1) story.downvotes += 1;

    votes[storyId] = newVote;
    saveUserVotes(currentUser.username, votes);
    saveStories();
    renderStories();
    renderProfileStatsAndAchievements();
  }

  // ---- Story modal & comments ----

  function initStoryModal() {
    const modal = $("storyModal");
    const closeBtn = $("closeStoryModalBtn");

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
  }

  function openStoryModal(storyId) {
    const story = getStoryById(storyId);
    if (!story) return;

    currentStoryForModal = story;
    const container = $("storyModalContent");
    const comments = story.comments || [];

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
      <div class="story-modal-body">${escapeHtml(story.content)}</div>

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

    const modal = $("storyModal");
    modal.hidden = false;

    $("modalCommentBtn").addEventListener("click", () => {
      if (!currentUser || !currentStoryForModal) return;
      const text = ($("modalCommentInput").value || "").trim();
      if (!text) return;

      if (!currentStoryForModal.comments) currentStoryForModal.comments = [];
      currentStoryForModal.comments.push({
        id: generateId(),
        author: currentUser.username,
        text,
        createdAt: new Date().toISOString(),
      });
      saveStories();
      renderStories();
      renderProfileStatsAndAchievements();
      openStoryModal(currentStoryForModal.id); // re-render
    });
  }

  // ---- Realm map ----

  function renderRealmMap() {
    const grid = $("realmGrid");
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
          : "Fertile land and quiet schemes.";

      return `
        <article class="region-card" data-region="${region}">
          <h3 class="region-name">${region}</h3>
          <p class="region-tagline">${tagline}</p>
          <p class="region-count">${count} chapter${count === 1 ? "" : "s"}</p>
        </article>
      `;
    }).join("");

    Array.from(grid.querySelectorAll(".region-card")).forEach((card) => {
      const region = card.getAttribute("data-region");
      card.addEventListener("click", () => {
        $("mapFilter").value = region;
        renderRealmStories();
      });
    });

    $("mapFilter").removeEventListener("change", renderRealmStories);
    $("mapFilter").addEventListener("change", renderRealmStories);

    renderRealmStories();
  }

  function renderRealmStories() {
    const regionFilter = $("mapFilter").value || "";
    const listEl = $("realmStories");
    const emptyEl = $("realmEmpty");

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
        const excerpt =
          s.content.length > 160
            ? s.content.slice(0, 160) + "…"
            : s.content;

        return `
        <article class="story-card" data-id="${s.id}">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="story-meta">
            by <strong>${escapeHtml(s.author)}</strong>
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
      viewBtn.addEventListener("click", () => openStoryModal(story.id));
    });
  }

  // ---- Ravens ----

  function loadRavens() {
    ravens = loadJSON(STORAGE_KEYS.RAVENS, []);
  }

  function saveRavens() {
    saveJSON(STORAGE_KEYS.RAVENS, ravens);
  }

  function initRavensUI() {
    $("sendRavenBtn").addEventListener("click", sendRaven);
    renderRavens();
  }

  function sendRaven() {
    if (!currentUser) return;

    const recipient = ($("ravenRecipient").value || "").trim();
    const message = ($("ravenMessage").value || "").trim();
    const statusEl = $("ravenStatus");

    if (!recipient || !message) {
      statusEl.textContent = "Recipient and message are required.";
      return;
    }

    const raven = {
      id: generateId(),
      from: currentUser.username,
      to: recipient,
      body: message,
      createdAt: new Date().toISOString(),
    };

    ravens.push(raven);
    saveRavens();

    $("ravenRecipient").value = "";
    $("ravenMessage").value = "";
    statusEl.textContent = "Raven sent (locally).";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2000);

    renderRavens();
  }

  function renderRavens() {
    if (!currentUser) return;

    const inboxEl = $("ravenInbox");
    const sentEl = $("ravenSent");
    const inboxEmptyEl = $("ravenInboxEmpty");
    const sentEmptyEl = $("ravenSentEmpty");

    const inbox = ravens
      .filter((r) => r.to === currentUser.username)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const sent = ravens
      .filter((r) => r.from === currentUser.username)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
            From <strong>${escapeHtml(r.from)}</strong>
            • ${escapeHtml(formatDate(r.createdAt))}
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
            To <strong>${escapeHtml(r.to)}</strong>
            • ${escapeHtml(formatDate(r.createdAt))}
          </div>
          <div class="raven-body">${escapeHtml(r.body)}</div>
        </article>
      `
        )
        .join("");
    }
  }

  // ---- Post-login initialization ----

  function initPostLogin() {
    loadStories();
    loadRavens();

    initTabs();
    initStoriesUI();
    initStoryModal();
    initProfileUI();
    initRavensUI();
    renderRealmMap();
  }

  // ---- Startup ----

  document.addEventListener("DOMContentLoaded", () => {
    enforceDomain();
    initLoginOverlay();

    const hasProfile = loadExistingProfile();
    if (hasProfile) {
      initPostLogin();
    }
  });
})();
