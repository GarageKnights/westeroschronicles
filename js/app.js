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
  ];

  const SORT_OPTIONS = [
    { value: "latest", label: "Latest" },
    { value: "top", label: "Top Rated" },
    { value: "oldest", label: "Oldest" },
  ];

  let currentUser = null; // Supabase profile + settings from DB
  let stories = [];       // From Supabase
  let ravens = [];        // From Supabase
  let userVotesMap = {};  // story_id -> value
  let currentStoryForModal = null;
  let currentParentStoryId = null;

  // ---- Helpers ----

  function $(id) {
    return document.getElementById(id);
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
      region: row.region || "Unknown",
      content: row.content,
      authorUsername: row.author_username || "Unknown",
      authorProfileId: row.author_profile_id || null,
      parentId: row.parent_id,
      upvotes: row.upvotes || 0,
      downvotes: row.downvotes || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function computeBranchCount(storyId, visited = new Set()) {
    let count = 0;
    const children = getChildrenOfStory(storyId);
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      count += 1;
      count += computeBranchCount(child.id, visited);
    }
    return count;
  }

  function countStoriesPerRegion() {
    const counts = {};
    for (const r of REGIONS) counts[r] = 0;
    for (const s of stories) {
      const region = s.region || "Unknown";
      if (!counts[region]) counts[region] = 0;
      counts[region]++;
    }
    return counts;
  }

  function getUserVoteForStory(storyId) {
    return userVotesMap[storyId] || 0;
  }

  function setUserVoteForStory(storyId, val) {
    userVotesMap[storyId] = val;
  }

  // ---- Toast / Status helpers ----

  function showStatus(message, type = "info") {
    const statusEl = $("globalStatus");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
    if (!message) return;
    setTimeout(() => {
      if (statusEl.textContent === message) {
        statusEl.textContent = "";
        statusEl.className = "status-message";
      }
    }, 5000);
  }

  function showError(message) {
    console.error(message);
    showStatus(message, "error");
  }

  function showSuccess(message) {
    showStatus(message, "success");
  }

  function showInfo(message) {
    showStatus(message, "info");
  }

  // Toast popup
  function showToast(message, type = "info") {
    const containerId = "toastContainer";
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---- Snow effect helpers ----

  function enableSnow() {
    let snowContainer = document.querySelector(".snow-container");
    if (!snowContainer) {
      snowContainer = document.createElement("div");
      snowContainer.className = "snow-container";
      document.body.appendChild(snowContainer);

      for (let i = 0; i < 80; i++) {
        const flake = document.createElement("div");
        flake.className = "snowflake";
        flake.textContent = "❄";
        flake.style.left = Math.random() * 100 + "%";
        flake.style.animationDelay = Math.random() * 10 + "s";
        flake.style.fontSize = 10 + Math.random() * 14 + "px";
        snowContainer.appendChild(flake);
      }
    }
    snowContainer.classList.add("snow-enabled");
  }

  function disableSnow() {
    const snowContainer = document.querySelector(".snow-container");
    if (snowContainer) {
      snowContainer.classList.remove("snow-enabled");
    }
  }

  // ---- Supabase Data ----

  async function loadStoriesFromSupabase() {
    try {
      const { data, error } = await window.supabaseClient
        .from("stories")
        .select(
          `
          id,
          title,
          region,
          content,
          author_username,
          author_profile_id,
          parent_id,
          upvotes,
          downvotes,
          created_at,
          updated_at
        `
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching stories:", error);
        showError("Error loading stories from the server.");
        return;
      }

      stories = (data || []).map(mapStoryRow);
      renderStoriesList();
      renderRealmMap();
    } catch (e) {
      console.error("Unexpected error loading stories:", e);
      showError("Unexpected error loading stories.");
    }
  }

  async function loadUserVotesFromSupabase() {
    if (!currentUser) {
      userVotesMap = {};
      return;
    }
    try {
      const { data, error } = await window.supabaseClient
        .from("votes")
        .select("story_id, value")
        .eq("profile_id", currentUser.id);

      if (error) {
        console.error("Error fetching user votes:", error);
        return;
      }

      userVotesMap = {};
      for (const row of data || []) {
        userVotesMap[row.story_id] = row.value;
      }
      renderStoriesList();
      if (currentStoryForModal) {
        openStoryModal(currentStoryForModal.id);
      }
    } catch (e) {
      console.error("Unexpected error loading votes:", e);
    }
  }

  async function loadRavensFromSupabase() {
    if (!currentUser) {
      ravens = [];
      renderRavensUI();
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("ravens")
        .select(
          `
        id,
        sender_id,
        sender_username,
        recipient_username,
        recipient_id,
        message,
        created_at
      `
        )
        .or(
          `sender_id.eq.${currentUser.id},recipient_username.eq.${currentUser.username}`
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching ravens:", error);
        showError("Error loading ravens from the server.");
        return;
      }

      ravens = data || [];
      renderRavensUI();
    } catch (e) {
      console.error("Unexpected error loading ravens:", e);
      showError("Unexpected error loading ravens.");
    }
  }

  async function submitStoryToSupabase({ title, region, content, parentId }) {
    if (!currentUser) {
      showError("You must be logged in to submit a story.");
      return;
    }
    try {
      const { error } = await window.supabaseClient
        .from("stories")
        .insert({
          title,
          region,
          content,
          author_username: currentUser.username,
          author_profile_id: currentUser.id,
          parent_id: parentId || null,
        });

      if (error) {
        console.error("Error inserting story:", error);
        showError("Error submitting story. Please try again.");
        return;
      }

      showSuccess("Story submitted to the realm!");
      await loadStoriesFromSupabase();
      await loadUserVotesFromSupabase();
    } catch (e) {
      console.error("Unexpected error submitting story:", e);
      showError("Unexpected error submitting story.");
    }
  }

  async function saveVoteToSupabase(storyId, value) {
    if (!currentUser) {
      showError("You must be logged in to vote.");
      return;
    }

    try {
      const { data, error: fetchErr } = await window.supabaseClient
        .from("votes")
        .select("id, value")
        .eq("profile_id", currentUser.id)
        .eq("story_id", storyId)
        .maybeSingle();

      if (fetchErr && fetchErr.code !== "PGRST116") {
        console.error("Error fetching existing vote:", fetchErr);
        showError("Error updating your vote.");
        return;
      }

      if (!data) {
        if (value === 0) return;
        const { error: insertErr } = await window.supabaseClient
          .from("votes")
          .insert({
            profile_id: currentUser.id,
            story_id: storyId,
            value,
          });
        if (insertErr) {
          console.error("Error inserting vote:", insertErr);
          showError("Error casting your vote.");
          return;
        }
      } else {
        if (value === 0) {
          const { error: deleteErr } = await window.supabaseClient
            .from("votes")
            .delete()
            .eq("id", data.id);
          if (deleteErr) {
            console.error("Error deleting vote:", deleteErr);
            showError("Error removing your vote.");
            return;
          }
        } else if (data.value !== value) {
          const { error: updateErr } = await window.supabaseClient
            .from("votes")
            .update({ value })
            .eq("id", data.id);
          if (updateErr) {
            console.error("Error updating vote:", updateErr);
            showError("Error updating your vote.");
            return;
          }
        } else {
          return;
        }
      }

      const { data: storyData, error: storyErr } = await window.supabaseClient
        .rpc("recalculate_story_votes", { storyid: storyId })
        .single()
        .catch(() => ({ data: null, error: null }));

      if (storyErr) {
        console.warn("Error recalculating story votes:", storyErr);
      }

      if (storyData) {
        const idx = stories.findIndex((s) => s.id === storyId);
        if (idx >= 0) {
          stories[idx] = mapStoryRow(storyData);
        }
      }

      setUserVoteForStory(storyId, value);
      renderStoriesList();
      if (currentStoryForModal) {
        openStoryModal(currentStoryForModal.id);
      }
    } catch (e) {
      console.error("Unexpected error saving vote:", e);
      showError("Unexpected error while voting.");
    }
  }

  async function sendRavenToSupabase({ recipientUsername, message }) {
    if (!currentUser) {
      showError("You must be logged in to send a raven.");
      return;
    }

    try {
      const { data: recipientProfile, error: profileErr } =
        await window.supabaseClient
          .from("profiles")
          .select("id, username")
          .ilike("username", recipientUsername)
          .maybeSingle();

      if (profileErr && profileErr.code !== "PGRST116") {
        console.error("Error looking up recipient:", profileErr);
        showError("Error finding that username.");
        return;
      }

      const { error: insertErr } = await window.supabaseClient
        .from("ravens")
        .insert({
          sender_id: currentUser.id,
          sender_username: currentUser.username,
          recipient_username: recipientUsername,
          recipient_id: recipientProfile ? recipientProfile.id : null,
          message,
        });

      if (insertErr) {
        console.error("Error sending raven:", insertErr);
        showError("Error sending raven. Please try again.");
        return;
      }

      showSuccess("Your raven takes wing.");
      await loadRavensFromSupabase();
    } catch (e) {
      console.error("Unexpected error sending raven:", e);
      showError("Unexpected error while sending raven.");
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

  async function saveProfileSnow(isOn) {
    if (!currentUser) return;
    const { error } = await window.supabaseClient
      .from("profiles")
      .update({ snow_enabled: isOn })
      .eq("id", currentUser.id);
    if (error) {
      console.error("Error saving snow setting:", error);
      showError("Error saving appearance setting.");
    }
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

    if (!saveBtn) return;

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

    toggleSnowEl.addEventListener("change", async () => {
      if (!currentUser) return;
      const isOn = toggleSnowEl.checked;

      if (!currentUser.settings) currentUser.settings = {};
      currentUser.settings.snow = isOn;
      currentUser.snow_enabled = isOn;

      if (isOn) {
        enableSnow();
      } else {
        disableSnow();
      }

      try {
        await saveProfileSnow(isOn);
      } catch (e) {
        console.error(e);
      }
    });

    logoutBtn.addEventListener("click", async () => {
      await window.logoutAndRedirect();
    });

    renderProfileCard();
    renderProfileStatsAndAchievements();
  }

  function renderProfileCard() {
	if (!currentUser) return;
	const cardEl = $("profileCard");
	if (!cardEl) return;
	
	const letter = (currentUser.username || "?").charAt(0).toUpperCase();
	const house = currentUser.house || "Wanderer";
	const bio = currentUser.bio || "No words written yet.";
	
	cardEl.innerHTML = `
	  <div class="profile-avatar house-${house.toLowerCase().replace(/\s+/g, '-')}">
        <span>${letter}</span>
      </div>
      <div class="profile-meta">
        <h3>${escapeHtml(currentUser.username)}</h3>
        <p class="profile-house">House: ${escapeHtml(house)}</p>
        <p class="profile-bio">${escapeHtml(bio)}</p>
      </div>
  `;
}

  function renderProfileStatsAndAchievements() {
    if (!currentUser) return;
    const statsEl = $("profileStats");
    const achEl = $("profileAchievements");
    if (!statsEl || !achEl) return;

    const authoredStories = stories.filter(
      (s) => s.authorUsername === currentUser.username
    );
    const storyCount = authoredStories.length;
    const totalUpvotes = authoredStories.reduce(
      (sum, s) => sum + (s.upvotes || 0),
      0
    );
    const totalDownvotes = authoredStories.reduce(
      (sum, s) => sum + (s.downvotes || 0),
      0
    );
    const bestStory = authoredStories.reduce((best, s) => {
      const score = getStoryScore(s);
      if (!best) return s;
      if (score > getStoryScore(best)) return s;
      return best;
    }, null);

    statsEl.innerHTML = `
      <div class="stat-block">
        <span class="stat-label">Stories Penned</span>
        <span class="stat-value">${storyCount}</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">Total Ravens of Praise</span>
        <span class="stat-value">${totalUpvotes}</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">Total Ravens of Scorn</span>
        <span class="stat-value">${totalDownvotes}</span>
      </div>
      ${
        bestStory
          ? `
      <div class="stat-block">
        <span class="stat-label">Most Honored Tale</span>
        <span class="stat-value">"${bestStory.title}" (${getStoryScore(
              bestStory
            )} score)</span>
      </div>
      `
          : ""
      }
    `;

    const achievements = [];

    if (storyCount >= 1) {
      achievements.push({
        title: "First Quill",
        description: "Penned your first tale in the chronicles.",
      });
    }
    if (storyCount >= 5) {
      achievements.push({
        title: "Prolific Scribe",
        description: "Wrote five or more stories.",
      });
    }
    if (totalUpvotes >= 10) {
      achievements.push({
        title: "Whispers on the Wind",
        description: "Earned at least 10 upvotes across your stories.",
      });
    }
    if (totalUpvotes >= 50) {
      achievements.push({
        title: "Beloved Bard",
        description: "Earned at least 50 upvotes across your stories.",
      });
    }

    const northernStories = authoredStories.filter(
      (s) => s.region === "The North"
    ).length;
    const dorneStories = authoredStories.filter(
      (s) => s.region === "Dorne"
    ).length;
    const beyondWallStories = authoredStories.filter(
      (s) => s.region === "Beyond the Wall"
    ).length;

    if (northernStories >= 1) {
      achievements.push({
        title: "Snowbound",
        description: "You’ve written of the frozen North.",
      });
    }
    if (dorneStories >= 1) {
      achievements.push({
        title: "Sun and Spear",
        description: "You’ve written of distant Dorne.",
      });
    }
    if (beyondWallStories >= 1) {
      achievements.push({
        title: "Whispers Beyond",
        description: "You’ve written of lands beyond the Wall.",
      });
    }

    if (achievements.length === 0) {
      achEl.innerHTML = `<p class="muted">No achievements yet. The quill awaits.</p>`;
    } else {
      achEl.innerHTML = achievements
        .map(
          (a) => `
        <div class="achievement">
          <h4>${a.title}</h4>
          <p>${a.description}</p>
        </div>
      `
        )
        .join("");
    }
  }

  // ---- Stories UI ----

  function renderStoriesList() {
    const listEl = $("storiesList");
    if (!listEl) return;

    const searchTerm = ($("storySearchInput")?.value || "").trim().toLowerCase();
    const regionFilter = $("regionFilter")?.value || "all";
    const sortValue = $("storySort")?.value || "latest";

    let filtered = [...stories];

    if (searchTerm) {
      filtered = filtered.filter((s) => {
        return (
          s.title.toLowerCase().includes(searchTerm) ||
          s.content.toLowerCase().includes(searchTerm) ||
          s.authorUsername.toLowerCase().includes(searchTerm)
        );
      });
    }

    if (regionFilter !== "all") {
      filtered = filtered.filter((s) => s.region === regionFilter);
    }

    filtered.sort((a, b) => {
      if (sortValue === "latest") {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      } else if (sortValue === "oldest") {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      } else if (sortValue === "top") {
        return getStoryScore(b) - getStoryScore(a);
      }
      return 0;
    });

    listEl.innerHTML = "";

    if (filtered.length === 0) {
      listEl.innerHTML =
        `<p class="muted">No stories match those criteria yet.</p>`;
      return;
    }

    for (const story of filtered) {
      const score = getStoryScore(story);
      const userVote = getUserVoteForStory(story.id);
      const root = getRootOfStory(story);
      const branchCount = computeBranchCount(story.id);

      const card = document.createElement("article");
      card.className = "story-card";
      card.dataset.storyId = story.id;

      const voteUpClass = userVote === 1 ? "voted" : "";
      const voteDownClass = userVote === -1 ? "voted" : "";

      card.innerHTML = `
        <header class="story-header">
          <div class="story-title-row">
            <h3 class="story-title">${story.title}</h3>
            <span class="story-region-tag">${story.region}</span>
          </div>
          <div class="story-meta">
            <span class="story-author">@${story.authorUsername}</span>
            ${
              root && root.id !== story.id
                ? `<span class="story-thread-info">Branch of: "${root.title}"</span>`
                : ""
            }
            ${
              branchCount > 0
                ? `<span class="story-branch-count">${branchCount} ${
                    branchCount === 1 ? "reply" : "replies"
                  }</span>`
                : ""
            }
            <span class="story-date">${formatDate(story.createdAt)}</span>
          </div>
        </header>
        <div class="story-excerpt">
          ${escapeHtml(story.content.slice(0, 220))}${
        story.content.length > 220 ? "…" : ""
      }
        </div>
        <footer class="story-footer">
          <div class="story-votes">
            <button class="vote-btn vote-up ${voteUpClass}" data-vote="up" aria-label="Upvote this story">
              ▲
            </button>
            <span class="story-score">${score}</span>
            <button class="vote-btn vote-down ${voteDownClass}" data-vote="down" aria-label="Downvote this story">
              ▼
            </button>
          </div>
          <button class="btn-link view-story-btn">Read full tale</button>
          <button class="btn-link reply-story-btn">Branch a new tale</button>
        </footer>
      `;

      const viewBtn = card.querySelector(".view-story-btn");
      const replyBtn = card.querySelector(".reply-story-btn");
      const voteButtons = card.querySelectorAll(".vote-btn");

      viewBtn.addEventListener("click", () => {
        openStoryModal(story.id);
      });

      replyBtn.addEventListener("click", () => {
        setParentStoryForSubmit(story.id);
      });

      voteButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const voteType = btn.dataset.vote;
          handleVoteClick(story.id, voteType);
        });
      });

      listEl.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setParentStoryForSubmit(storyId) {
    const story = getStoryById(storyId);
    currentParentStoryId = story ? story.id : null;
    const parentLabel = $("parentStoryLabel");
    if (!parentLabel) return;
    if (!story) {
      parentLabel.textContent = "Starting a new, original tale.";
      parentLabel.classList.remove("has-parent");
    } else {
      parentLabel.textContent = `Branching from: "${story.title}" by @${story.authorUsername}`;
      parentLabel.classList.add("has-parent");
      const submitTabButton = document.querySelector(
        '[data-tab-target="submitTab"]'
      );
      if (submitTabButton) {
        submitTabButton.click();
      }
      const storyTitleInput = $("storyTitle");
      if (storyTitleInput && !storyTitleInput.value) {
        storyTitleInput.focus();
      }
    }
  }

  function handleVoteClick(storyId, voteType) {
    if (!requireLogin()) return;

    const currentVote = getUserVoteForStory(storyId);
    let newVote = 0;
    if (voteType === "up") {
      newVote = currentVote === 1 ? 0 : 1;
    } else if (voteType === "down") {
      newVote = currentVote === -1 ? 0 : -1;
    }
    saveVoteToSupabase(storyId, newVote);
  }

  function initStoriesUI() {
    const storySearchInput = $("storySearchInput");
    const regionFilter = $("regionFilter");
    const storySort = $("storySort");
    const storyForm = $("storyForm");

    if (!storySearchInput || !regionFilter || !storySort || !storyForm) return;

    regionFilter.innerHTML =
      `<option value="all">All Regions</option>` +
      REGIONS.map((r) => `<option value="${r}">${r}</option>`).join("");

    storySort.innerHTML = SORT_OPTIONS.map(
      (opt) =>
        `<option value="${opt.value}" ${
          opt.value === "latest" ? "selected" : ""
        }>${opt.label}</option>`
    ).join("");

    storySearchInput.addEventListener("input", () => {
      renderStoriesList();
    });

    regionFilter.addEventListener("change", () => {
      renderStoriesList();
    });

    storySort.addEventListener("change", () => {
      renderStoriesList();
    });

    storyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireLogin()) return;

      const titleEl = $("storyTitle");
      const regionEl = $("storyRegion");
      const contentEl = $("storyContent");

      if (!titleEl || !regionEl || !contentEl) return;

      const title = titleEl.value.trim();
      const region = regionEl.value;
      const content = contentEl.value.trim();

      if (!title || !region || !content) {
        showError("Please provide a title, region, and story content.");
        return;
      }

      await submitStoryToSupabase({
        title,
        region,
        content,
        parentId: currentParentStoryId,
      });

      titleEl.value = "";
      contentEl.value = "";
      const parentLabel = $("parentStoryLabel");
      if (parentLabel) {
        parentLabel.textContent = "Starting a new, original tale.";
        parentLabel.classList.remove("has-parent");
      }
      currentParentStoryId = null;
    });

    const regionSelect = $("storyRegion");
    if (regionSelect) {
      regionSelect.innerHTML =
        `<option value="">Select a region</option>` +
        REGIONS.map((r) => `<option value="${r}">${r}</option>`).join("");
    }
  }

  function initStoryModal() {
    const modal = $("storyModal");
    const modalContent = $("storyModalContent");
    const modalClose = $("storyModalClose");
    const replyBtn = $("modalReplyBtn");

    if (!modal || !modalContent || !modalClose || !replyBtn) return;

    modalClose.addEventListener("click", () => {
      modal.classList.remove("open");
      currentStoryForModal = null;
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("open");
        currentStoryForModal = null;
      }
    });

    replyBtn.addEventListener("click", () => {
      if (currentStoryForModal) {
        setParentStoryForSubmit(currentStoryForModal.id);
      }
    });
  }

  async function openStoryModal(storyId) {
    const modal = $("storyModal");
    const titleEl = $("modalStoryTitle");
    const metaEl = $("modalStoryMeta");
    const bodyEl = $("modalStoryBody");
    const branchInfoEl = $("modalBranchInfo");
    const voteUpBtn = $("modalVoteUp");
    const voteDownBtn = $("modalVoteDown");
    const scoreEl = $("modalStoryScore");

    if (
      !modal ||
      !titleEl ||
      !metaEl ||
      !bodyEl ||
      !voteUpBtn ||
      !voteDownBtn ||
      !scoreEl ||
      !branchInfoEl
    )
      return;

    const story = getStoryById(storyId);
    if (!story) {
      showError("Story not found.");
      return;
    }

    currentStoryForModal = story;

    titleEl.textContent = story.title;
    bodyEl.textContent = story.content;

    const root = getRootOfStory(story);
    const branchCount = computeBranchCount(story.id);
    const score = getStoryScore(story);
    const userVote = getUserVoteForStory(story.id);

    metaEl.innerHTML = `
      <span class="story-region-tag">${story.region}</span>
      <span class="story-author">@${story.authorUsername}</span>
      <span class="story-date">${formatDate(story.createdAt)}</span>
    `;

    if (root && root.id !== story.id) {
      branchInfoEl.innerHTML = `
        <div class="branch-info">
          <span>Branch of: "${root.title}"</span>
          ${
            branchCount > 0
              ? `<span>Has ${branchCount} ${
                  branchCount === 1 ? "reply" : "replies"
                } coiled beneath it.</span>`
              : ""
          }
        </div>
      `;
    } else if (branchCount > 0) {
      branchInfoEl.innerHTML = `
        <div class="branch-info">
          <span>Root tale with ${branchCount} ${
        branchCount === 1 ? "reply" : "replies"
      } branching off.</span>
        </div>
      `;
    } else {
      branchInfoEl.innerHTML = `
        <div class="branch-info">
          <span>This tale stands alone... for now.</span>
        </div>
      `;
    }

    scoreEl.textContent = score;

    voteUpBtn.classList.toggle("voted", userVote === 1);
    voteDownBtn.classList.toggle("voted", userVote === -1);

    voteUpBtn.onclick = () => handleVoteClick(story.id, "up");
    voteDownBtn.onclick = () => handleVoteClick(story.id, "down");

    modal.classList.add("open");
  }

  // ---- Realm Map ----

  function renderRealmMap() {
    const mapGrid = $("realmRegionsContainer");
    if (!mapGrid) return;

    const counts = countStoriesPerRegion();

    mapGrid.innerHTML = "";

    for (const region of REGIONS) {
      const count = counts[region] || 0;
      const hasStories = count > 0;

      const card = document.createElement("button");
      card.type = "button";
      card.className = "realm-region-card";
      if (hasStories) {
        card.classList.add("has-stories");
      }

      card.innerHTML = `
        <div class="realm-region-header">
          <span class="realm-region-name">${region}</span>
        </div>
        <div class="realm-region-body">
          <span class="realm-region-count">${count} ${
        count === 1 ? "tale" : "tales"
      }</span>
          <span class="realm-region-hint">${
            hasStories
              ? "Click to filter stories to this region."
              : "No tales yet. Perhaps you’ll be the first."
          }</span>
        </div>
      `;

      card.addEventListener("click", () => {
        const regionFilter = $("regionFilter");
        if (regionFilter) {
          regionFilter.value = region;
          renderStoriesList();
          const storiesTabButton = document.querySelector(
            '[data-tab-target="storiesTab"]'
          );
          if (storiesTabButton) storiesTabButton.click();
        }
      });

      mapGrid.appendChild(card);
    }
  }

  // ---- Ravens UI ----

  function renderRavensUI() {
    const inboxList = $("ravenInbox");
    const sentList = $("ravenSent");
    const emptyInbox = $("emptyInbox");
    const emptySent = $("emptySent");

    if (!inboxList || !sentList) return;

    inboxList.innerHTML = "";
    sentList.innerHTML = "";

    if (!currentUser) {
      inboxList.innerHTML =
        `<p class="muted">Log in to see ravens that have reached you.</p>`;
      sentList.innerHTML =
        `<p class="muted">Log in to see ravens you’ve sent.</p>`;
      if (emptyInbox) emptyInbox.style.display = "none";
      if (emptySent) emptySent.style.display = "none";
      return;
    }

    const inbox = ravens.filter(
      (r) => r.recipient_username === currentUser.username
    );
    const sent = ravens.filter((r) => r.sender_id === currentUser.id);

    if (inbox.length === 0) {
      inboxList.innerHTML =
        `<p class="muted">No ravens perched on your sill yet.</p>`;
      if (emptyInbox) emptyInbox.style.display = "block";
    } else {
      if (emptyInbox) emptyInbox.style.display = "none";
      for (const raven of inbox) {
        const li = document.createElement("li");
        li.className = "raven-item";
        li.innerHTML = `
          <div class="raven-header">
            <span class="raven-from">From: @${raven.sender_username}</span>
            <span class="raven-date">${formatDate(raven.created_at)}</span>
          </div>
          <div class="raven-message">${escapeHtml(raven.message)}</div>
        `;
        inboxList.appendChild(li);
      }
    }

    if (sent.length === 0) {
      sentList.innerHTML =
        `<p class="muted">No ravens have taken wing from your rookery yet.</p>`;
      if (emptySent) emptySent.style.display = "block";
    } else {
      if (emptySent) emptySent.style.display = "none";
      for (const raven of sent) {
        const li = document.createElement("li");
        li.className = "raven-item raven-sent";
        li.innerHTML = `
          <div class="raven-header">
            <span class="raven-to">To: @${raven.recipient_username}</span>
            <span class="raven-date">${formatDate(raven.created_at)}</span>
          </div>
          <div class="raven-message">${escapeHtml(raven.message)}</div>
        `;
        sentList.appendChild(li);
      }
    }
  }

  function initRavensUI() {
    const form = $("ravenForm");
    const toInput = $("ravenTo");
    const bodyInput = $("ravenBody");

    if (!form || !toInput || !bodyInput) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireLogin()) return;

      const recipient = toInput.value.trim();
      const message = bodyInput.value.trim();

      if (!recipient || !message) {
        showError("Please provide a recipient and a message for your raven.");
        return;
      }

      await sendRavenToSupabase({
        recipientUsername: recipient,
        message,
      });

      bodyInput.value = "";
    });
  }

  // ---- Tabs & navigation ----

  function initTabs() {
    const tabButtons = document.querySelectorAll("[data-tab-target]");
    const tabs = document.querySelectorAll(".tab-pane");

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab-target");
        if (!target) return;
        const tab = $(target);
        if (!tab) return;

        tabButtons.forEach((b) => b.classList.remove("active"));
        tabs.forEach((t) => t.classList.remove("active"));

        btn.classList.add("active");
        tab.classList.add("active");
      });
    });

    const initialTab = $("storiesTab");
    const initialBtn = document.querySelector(
      '[data-tab-target="storiesTab"]'
    );
    if (initialTab && initialBtn) {
      initialTab.classList.add("active");
      initialBtn.classList.add("active");
    }
  }

  // ---- Header / Auth status ----

  function renderUserStatus() {
    const userStatusEl = $("userStatus");
    const mobileStatusEl = $("mobileUserStatus");
    if (!userStatusEl && !mobileStatusEl) return;

    const html = currentUser
      ? `
        <span class="user-pill house-${(currentUser.house || "")
          .toLowerCase()
          .replace(/\s+/g, "-")}">
          <span class="user-pill-initial">${String(
            currentUser.username || "?"
          )
            .charAt(0)
            .toUpperCase()}</span>
          <span class="user-pill-name">@${currentUser.username}</span>
          <span class="user-pill-house">${currentUser.house || "Wanderer"}</span>
        </span>
      `
      : `
        <a href="login.html" class="link-muted">Log in</a>
        <span class="divider">|</span>
        <a href="signup.html" class="link-muted">Join the realm</a>
      `;

    if (userStatusEl) userStatusEl.innerHTML = html;
    if (mobileStatusEl) mobileStatusEl.innerHTML = html;
  }

  function applyHouseTheme(house) {
    const body = document.body;
    body.classList.remove(
      "house-stark",
      "house-arryn",
      "house-tully",
      "house-lannister",
      "house-tyrell",
      "house-martell",
      "house-baratheon",
      "house-targaryen",
      "house-nightswatch",
      "house-wanderer"
    );

    switch ((house || "").toLowerCase()) {
      case "stark":
        body.classList.add("house-stark");
        break;
      case "arryn":
        body.classList.add("house-arryn");
        break;
      case "tully":
        body.classList.add("house-tully");
        break;
      case "lannister":
        body.classList.add("house-lannister");
        break;
      case "tyrell":
        body.classList.add("house-tyrell");
        break;
      case "martell":
        body.classList.add("house-martell");
        break;
      case "baratheon":
        body.classList.add("house-baratheon");
        break;
      case "targaryen":
        body.classList.add("house-targaryen");
        break;
      case "night's watch":
      case "nightswatch":
      case "nightwatch":
        body.classList.add("house-nightswatch");
        break;
      default:
        body.classList.add("house-wanderer");
        break;
    }
  }

  function updateAuthLinks() {
    const loginLinks = document.querySelectorAll(".login-link");
    const signupLinks = document.querySelectorAll(".signup-link");
    const profileLinks = document.querySelectorAll(".profile-link");

    if (currentUser) {
      loginLinks.forEach((el) => (el.style.display = "none"));
      signupLinks.forEach((el) => (el.style.display = "none"));
      profileLinks.forEach((el) => (el.style.display = ""));
    } else {
      loginLinks.forEach((el) => (el.style.display = ""));
      signupLinks.forEach((el) => (el.style.display = ""));
      profileLinks.forEach((el) => (el.style.display = "none"));
    }
  }

  // ---- Toast initialization ----

  function initToasts() {
    const toastEls = document.querySelectorAll("[data-toast]");
    toastEls.forEach((el) => {
      const msg = el.dataset.toast || el.textContent;
      const type = el.dataset.toastType || "info";
      if (msg) {
        showToast(msg, type);
      }
      el.remove();
    });
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

    const isFile = hostname === "" || hostname === "localhost";
    const isCorrectDomain = hostname.includes("westeroschronicles.com");

    if (!warningEl) return;

    if (isFile || isCorrectDomain) {
      warningEl.style.display = "none";
    } else {
      warningEl.style.display = "block";
      warningEl.textContent =
        "⚠ You are viewing a mirrored or development version of WesterosChronicles.com. For the true experience, visit westeroschronicles.com.";
    }
  }

  // ---- Post-login (really "post-init") ----

  async function initPostLogin() {
    await loadStoriesFromSupabase();
    await loadUserVotesFromSupabase();
    await loadRavensFromSupabase();

    initTabs();
    initStoriesUI();
    initStoryModal();
    initProfileUI();
    initRavensUI();
    initToasts();
  }

  // ---- Bootstrapping ----

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
      const settings = { snow: !!profile.snow_enabled };
      currentUser = {
        ...profile,
        settings,
      };
      applyHouseTheme(currentUser.house);
    } else {
      currentUser = null; // guest mode
    }

    renderUserStatus();
    updateAuthLinks();

    await initPostLogin();
  });
})();
