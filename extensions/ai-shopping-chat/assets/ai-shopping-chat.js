(() => {
  function initAIShoppingChat() {
    const widget = document.getElementById("ai-shopping-widget");
    if (!widget || widget.dataset.initialized === "true") return;

    widget.dataset.initialized = "true";

    const toggle = document.getElementById("ai-chat-toggle");
    const chatWindow = document.getElementById("ai-chat-window");
    const close = document.getElementById("ai-chat-close");
    const form = document.getElementById("ai-chat-form");
    const input = document.getElementById("ai-chat-input");
    const messages = document.getElementById("ai-chat-messages");

    let currentProduct = null;
    let currentVariantId = null;

    let shoppingContext = {
      lastQuery: "",
      lastProducts: [],
      lastSelectedProductUrl: "",
      lastSelectedProductTitle: ""
    };

    const CHAT_STORAGE_KEY = "ai-shopping-chat-session-v1";

    function saveChatSession() {
      try {
        sessionStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify({
            html: messages.innerHTML,
            open: !chatWindow.hidden,
          })
        );
      } catch (error) {
        console.warn("Could not save AI chat session:", error);
      }
    }

    function restoreChatSession() {
      try {
        const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
        if (!raw) return;

        const saved = JSON.parse(raw);

        if (saved?.html) {
          messages.innerHTML = saved.html;
        }

        if (saved?.open === true) {
          chatWindow.hidden = false;
        }
      } catch (error) {
        console.warn("Could not restore AI chat session:", error);
      }
    }

    function rootUrl(path) {
      return `${window.Shopify?.routes?.root || "/"}${path}`;
    }

    function refreshThemeCart() {
      document.documentElement.dispatchEvent(
        new CustomEvent("cart:refresh", { bubbles: true })
      );

      document.dispatchEvent(
        new CustomEvent("cart:refresh", { bubbles: true })
      );

      document.dispatchEvent(
        new CustomEvent("cart:updated", { bubbles: true })
      );
    }

    async function getCart() {
      const response = await fetch(rootUrl("cart.js"), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Could not load your cart.");
      }

      return response.json();
    }

    async function changeCartLine(key, quantity) {
      const response = await fetch(rootUrl("cart/change.js"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          id: key,
          quantity,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.description ||
          result?.message ||
          "Could not update the cart."
        );
      }

      refreshThemeCart();
      return result;
    }

    async function clearShopifyCart() {
      const response = await fetch(rootUrl("cart/clear.js"), {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error("Could not clear the cart.");
      }

      refreshThemeCart();
      return result;
    }

    function normalizeText(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function findBestCartItem(cart, query) {
      const normalizedQuery = normalizeText(query);

      if (!cart?.items?.length) return null;

      if (!normalizedQuery) {
        return cart.items.length === 1 ? cart.items[0] : null;
      }

      const words = normalizedQuery
        .split(" ")
        .filter(
          (word) =>
            word.length > 1 &&
            ![
              "remove",
              "delete",
              "from",
              "cart",
              "item",
              "product",
              "the",
              "my",
              "please",
              "change",
              "update",
              "quantity",
              "qty",
              "set",
              "to",
            ].includes(word)
        );

      let best = null;
      let bestScore = 0;

      for (const item of cart.items) {
        const haystack = normalizeText(
          `${item.product_title || ""} ${item.variant_title || ""} ${
            item.title || ""
          }`
        );

        let score = 0;

        for (const word of words) {
          if (haystack.includes(word)) score += 1;
        }

        if (normalizedQuery && haystack.includes(normalizedQuery)) {
          score += 5;
        }

        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }

      return bestScore > 0 ? best : null;
    }

    function extractQuantity(text) {
      const patterns = [
        /(?:quantity|qty)\s*(?:to|=)?\s*(\d+)/i,
        /(?:change|update|set).*?(?:to)\s*(\d+)/i,
        /\b(\d+)\b/,
      ];

      for (const pattern of patterns) {
        const match = String(text).match(pattern);

        if (match) {
          return Math.max(0, Number(match[1]));
        }
      }

      return null;
    }

    function showCartInChat(cart) {
      if (!cart?.items?.length) {
        addBotMessage("Your cart is currently empty.");
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "ai-cart-results";

      const heading = document.createElement("div");
      heading.className = "ai-cart-heading";
      heading.textContent = `Your cart (${cart.item_count} ${
        cart.item_count === 1 ? "item" : "items"
      })`;

      wrapper.appendChild(heading);

      cart.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "ai-cart-item";

        if (item.image) {
          const image = document.createElement("img");
          image.src = item.image;
          image.alt = item.product_title || item.title || "Cart product";
          image.loading = "lazy";
          row.appendChild(image);
        }

        const info = document.createElement("div");
        info.className = "ai-cart-item-info";

        const title = document.createElement("strong");
        title.textContent = item.product_title || item.title;
        info.appendChild(title);

        if (
          item.variant_title &&
          item.variant_title !== "Default Title"
        ) {
          const variant = document.createElement("small");
          variant.textContent = item.variant_title;
          info.appendChild(variant);
        }

        const meta = document.createElement("span");
        meta.textContent =
          `Qty: ${item.quantity} • ${formatMoney(
            Number(item.final_line_price || item.line_price || 0) / 100
          )}`;

        info.appendChild(meta);

        const controls = document.createElement("div");
        controls.className = "ai-cart-controls";

        const minus = document.createElement("button");
        minus.type = "button";
        minus.textContent = "−";

        minus.addEventListener("click", async () => {
          minus.disabled = true;

          try {
            const updated = await changeCartLine(
              item.key,
              Math.max(0, item.quantity - 1)
            );

            addBotMessage(
              item.quantity <= 1
                ? `${item.product_title} removed from your cart.`
                : `${item.product_title} quantity updated.`
            );

            showCartInChat(updated);
          } catch (error) {
            addBotMessage(error.message);
          }
        });

        const qty = document.createElement("span");
        qty.textContent = item.quantity;

        const plus = document.createElement("button");
        plus.type = "button";
        plus.textContent = "+";

        plus.addEventListener("click", async () => {
          plus.disabled = true;

          try {
            const updated = await changeCartLine(
              item.key,
              item.quantity + 1
            );

            addBotMessage(
              `${item.product_title} quantity updated to ${
                item.quantity + 1
              }.`
            );

            showCartInChat(updated);
          } catch (error) {
            addBotMessage(error.message);
          }
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ai-cart-remove";
        remove.textContent = "Remove";

        remove.addEventListener("click", async () => {
          remove.disabled = true;

          try {
            const updated = await changeCartLine(item.key, 0);

            addBotMessage(
              `${item.product_title} removed from your cart.`
            );

            showCartInChat(updated);
          } catch (error) {
            addBotMessage(error.message);
          }
        });

        controls.appendChild(minus);
        controls.appendChild(qty);
        controls.appendChild(plus);
        controls.appendChild(remove);

        info.appendChild(controls);
        row.appendChild(info);
        wrapper.appendChild(row);
      });

      const footer = document.createElement("div");
      footer.className = "ai-cart-footer";

      const total = document.createElement("strong");
      total.textContent = `Total: ${formatMoney(
        Number(cart.total_price || 0) / 100
      )}`;

      const checkout = document.createElement("button");
      checkout.type = "button";
      checkout.className = "ai-cart-checkout";
      checkout.textContent = "Checkout";

      checkout.addEventListener("click", () => {
        window.location.href = rootUrl("checkout");
      });

      footer.appendChild(total);
      footer.appendChild(checkout);

      wrapper.appendChild(footer);
      messages.appendChild(wrapper);

      scrollToBottom();
      saveChatSession();
    }

    async function handleCartCommand(value) {
      const text = normalizeText(value);

      const wantsCheckout =
        /\b(checkout|check out|proceed to checkout|buy now)\b/i.test(
          value
        );

      if (wantsCheckout) {
        const cart = await getCart();

        if (!cart.items?.length) {
          addBotMessage(
            "Your cart is empty. Add a product before checkout."
          );
          return true;
        }

        addBotMessage("Opening secure Shopify checkout...");
        saveChatSession();

        window.location.href = rootUrl("checkout");
        return true;
      }

      const wantsClear =
        /\b(clear|empty)\b.*\bcart\b/i.test(value) ||
        /\bremove all\b/i.test(value);

      if (wantsClear) {
        const cart = await getCart();

        if (!cart.items?.length) {
          addBotMessage("Your cart is already empty.");
          return true;
        }

        await clearShopifyCart();
        addBotMessage("Your cart has been cleared.");
        return true;
      }

      const wantsShowCart =
        /\b(show|view|open|see|what.*in)\b.*\bcart\b/i.test(value) ||
        /^(cart|my cart)$/i.test(value.trim());

      if (wantsShowCart) {
        const cart = await getCart();
        showCartInChat(cart);
        return true;
      }

      const wantsRemove =
        /\b(remove|delete)\b/i.test(value) &&
        /\bcart\b/i.test(value);

      if (wantsRemove) {
        const cart = await getCart();

        if (!cart.items?.length) {
          addBotMessage("Your cart is already empty.");
          return true;
        }

        const item = findBestCartItem(cart, value);

        if (!item) {
          if (cart.items.length > 1) {
            addBotMessage(
              "I couldn't tell which cart item you want to remove. Please include the product name."
            );

            showCartInChat(cart);
          } else {
            await changeCartLine(cart.items[0].key, 0);
            addBotMessage(
              `${cart.items[0].product_title} removed from your cart.`
            );
          }

          return true;
        }

        await changeCartLine(item.key, 0);

        addBotMessage(
          `${item.product_title} removed from your cart.`
        );

        return true;
      }

      const wantsQuantityChange =
        /\b(change|update|set)\b/i.test(value) &&
        /\b(quantity|qty|cart)\b/i.test(value);

      if (wantsQuantityChange) {
        const cart = await getCart();

        if (!cart.items?.length) {
          addBotMessage("Your cart is empty.");
          return true;
        }

        const quantity = extractQuantity(value);

        if (quantity === null) {
          addBotMessage(
            "Tell me the quantity you want, for example: change snowboard quantity to 3."
          );
          return true;
        }

        const item = findBestCartItem(cart, value);

        if (!item) {
          if (cart.items.length === 1) {
            const onlyItem = cart.items[0];

            await changeCartLine(onlyItem.key, quantity);

            addBotMessage(
              quantity === 0
                ? `${onlyItem.product_title} removed from your cart.`
                : `${onlyItem.product_title} quantity changed to ${quantity}.`
            );

            return true;
          }

          addBotMessage(
            "Please include the product name so I know which cart item to update."
          );

          showCartInChat(cart);
          return true;
        }

        await changeCartLine(item.key, quantity);

        addBotMessage(
          quantity === 0
            ? `${item.product_title} removed from your cart.`
            : `${item.product_title} quantity changed to ${quantity}.`
        );

        return true;
      }

      return false;
    }

    // ==========================================
    // CHAT OPEN / CLOSE
    // ==========================================

    toggle?.addEventListener("click", () => {
      chatWindow.hidden = false;
      input?.focus();
      saveChatSession();
    });

    close?.addEventListener("click", () => {
      chatWindow.hidden = true;
      saveChatSession();
    });

    function scrollToBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function addUserMessage(text) {
      const el = document.createElement("div");
      el.className = "ai-message ai-message-user";
      el.textContent = text;
      messages.appendChild(el);
      scrollToBottom();
      saveChatSession();
    }

    function addBotMessage(text) {
      const el = document.createElement("div");
      el.className = "ai-message ai-message-bot";
      el.textContent = text;
      messages.appendChild(el);
      scrollToBottom();
      saveChatSession();
      return el;
    }

    // ==========================================
    // MONEY
    // ==========================================

    function formatMoney(value) {
      if (value === null || value === undefined || value === "") {
        return "";
      }

      const number = Number(value);

      if (Number.isNaN(number)) return String(value);

      try {
        return new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: window.Shopify?.currency?.active || "INR",
        }).format(number);
      } catch {
        return `₹${number.toLocaleString("en-IN")}`;
      }
    }

    // ==========================================
    // CLEAN SEARCH
    // ==========================================

    function cleanSearchQuery(text) {
      return String(text || "")
        .replace(
          /\b(find|show|search|give|need|want|looking|for|me|please|product|products)\b/gi,
          " "
        )
        .replace(/\s+/g, " ")
        .trim();
    }

    // ==========================================
    // SMART SHOPPING SEARCH
    // ==========================================

    function editDistance(a, b) {
      a = normalizeText(a);
      b = normalizeText(b);

      const matrix = Array.from(
        { length: b.length + 1 },
        () => Array(a.length + 1).fill(0)
      );

      for (let i = 0; i <= b.length; i++) {
        matrix[i][0] = i;
      }

      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          matrix[i][j] =
            b[i - 1] === a[j - 1]
              ? matrix[i - 1][j - 1]
              : Math.min(
                  matrix[i - 1][j - 1] + 1,
                  matrix[i][j - 1] + 1,
                  matrix[i - 1][j] + 1
                );
        }
      }

      return matrix[b.length][a.length];
    }

    function similarity(a, b) {
      const first = normalizeText(a);
      const second = normalizeText(b);

      if (!first || !second) return 0;

      if (
        first.includes(second) ||
        second.includes(first)
      ) {
        return 1;
      }

      const longest = Math.max(
        first.length,
        second.length
      );

      return 1 - editDistance(first, second) / longest;
    }

    function getSearchWords(value) {
      return normalizeText(value)
        .split(" ")
        .filter(
          (word) =>
            word.length > 1 &&
            ![
              "find",
              "show",
              "search",
              "give",
              "need",
              "want",
              "looking",
              "for",
              "me",
              "please",
              "product",
              "products",
              "something",
              "some",
              "the",
              "a",
              "an"
            ].includes(word)
        );
    }

    function rankProducts(products, originalQuery) {
      const words = getSearchWords(originalQuery);

      return [...products]
        .map((product) => {
          const searchable = normalizeText(
            `${product.title || ""} ${
              product.type || product.product_type || ""
            } ${
              Array.isArray(product.tags)
                ? product.tags.join(" ")
                : product.tags || ""
            }`
          );

          let score = 0;

          words.forEach((word) => {
            if (searchable.includes(word)) {
              score += 10;
              return;
            }

            const productWords =
              searchable.split(" ");

            const bestSimilarity = Math.max(
              0,
              ...productWords.map((productWord) =>
                similarity(word, productWord)
              )
            );

            if (bestSimilarity >= 0.8) {
              score += 7;
            } else if (bestSimilarity >= 0.65) {
              score += 3;
            }
          });

          return {
            product,
            score
          };
        })
        .sort((a, b) => b.score - a.score)
        .map((item) => item.product);
    }

    function isSimilarRequest(value) {
      return /\b(similar|related|like this|like that|same type|something like)\b/i.test(
        value
      );
    }

    function isCheaperRequest(value) {
      return /\b(cheap|cheaper|lower price|less expensive|budget)\b/i.test(
        value
      );
    }

    function getContextualQuery(value) {
      if (
        (isSimilarRequest(value) ||
          isCheaperRequest(value)) &&
        shoppingContext.lastQuery
      ) {
        return shoppingContext.lastQuery;
      }

      return value;
    }

    async function broadProductSearch(query) {
      const params = new URLSearchParams();

      params.set("q", query);
      params.set("type", "product");
      params.set("options[prefix]", "last");

      const response = await fetch(
        `/search?q=${encodeURIComponent(
          query
        )}&type=product&view=ajax`
      );

      return response;
    }

    // ==========================================
    // SHOPIFY SEARCH
    // ==========================================

    async function searchShopifyProducts(query) {
      const cleanedQuery = cleanSearchQuery(query) || query;

      async function predictiveSearch(searchTerm) {
        const params = new URLSearchParams();

        params.set("q", searchTerm);
        params.set("resources[type]", "product");
        params.set("resources[limit]", "10");
        params.set(
          "resources[options][unavailable_products]",
          "last"
        );
        params.set(
          "resources[options][fields]",
          "title,product_type,variants.title,variants.sku,tag"
        );

        const response = await fetch(
          `/search/suggest.json?${params.toString()}`,
          {
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          return [];
        }

        const data = await response.json();

        return data?.resources?.results?.products || [];
      }

      const resultMap = new Map();

      function addProducts(products) {
        products.forEach((product) => {
          const key =
            product.url ||
            product.handle ||
            product.id ||
            product.title;

          if (key && !resultMap.has(key)) {
            resultMap.set(key, product);
          }
        });
      }

      // Exact/full search first
      addProducts(
        await predictiveSearch(cleanedQuery)
      );

      const words = getSearchWords(cleanedQuery);

      // Search important words separately so one narrow
      // predictive result does not hide other matches.
      for (const word of words) {
        if (word.length < 3) continue;

        addProducts(
          await predictiveSearch(word)
        );
      }

      // Partial fallback.
      // Useful for searches such as "snowbo" -> snowboard.
      if (resultMap.size < 3) {
        for (const word of words) {
          if (word.length < 5) continue;

          const prefixes = [
            word.slice(0, -1),
            word.slice(0, -2),
            word.slice(0, Math.max(3, word.length - 3))
          ];

          for (const prefix of prefixes) {
            if (prefix.length < 3) continue;

            addProducts(
              await predictiveSearch(prefix)
            );

            if (resultMap.size >= 10) {
              break;
            }
          }

          if (resultMap.size >= 10) {
            break;
          }
        }
      }

      const products = Array.from(
        resultMap.values()
      );

      return rankProducts(
        products,
        cleanedQuery
      ).slice(0, 10);
    }

    // ==========================================
    // LOAD FULL PRODUCT JSON
    // ==========================================

    async function getFullProduct(productUrl) {
      const url = new URL(productUrl, window.location.origin);

      let path = url.pathname;

      if (path.endsWith("/")) {
        path = path.slice(0, -1);
      }

      const response = await fetch(`${path}.js`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Could not load product details.");
      }

      return response.json();
    }

    // ==========================================
    // PRODUCT CARD
    // ==========================================

    function createProductCard(product) {
      const card = document.createElement("div");
      card.className = "ai-product-card";

      const imageUrl =
        product?.image?.url ||
        product?.featured_image?.url ||
        product?.featured_image ||
        "";

      const title = product?.title || "Shopify Product";
      const price = product?.price || product?.price_min || "";
      const productUrl = product?.url || "#";

      if (imageUrl) {
        const image = document.createElement("img");

        image.src = imageUrl;
        image.alt = title;
        image.loading = "lazy";
        image.className = "ai-product-image";
        image.dataset.productUrl = productUrl;

        card.appendChild(image);
      }

      const content = document.createElement("div");
      content.className = "ai-product-card-content";

      const titleButton = document.createElement("button");
      titleButton.type = "button";
      titleButton.className = "ai-product-title ai-product-title-button";
      titleButton.textContent = title;
      titleButton.dataset.productUrl = productUrl;

      content.appendChild(titleButton);

      if (price !== "") {
        const priceEl = document.createElement("div");
        priceEl.className = "ai-product-price";
        priceEl.textContent = formatMoney(price);
        content.appendChild(priceEl);
      }

      const actions = document.createElement("div");
      actions.className = "ai-product-actions";

      const quickView = document.createElement("button");
      quickView.type = "button";
      quickView.className = "ai-product-view";
      quickView.textContent = "Quick view";
      quickView.dataset.productUrl = productUrl;

      actions.appendChild(quickView);
      content.appendChild(actions);
      card.appendChild(content);

      return card;
    }

    function showProducts(products) {
      const wrapper = document.createElement("div");
      wrapper.className = "ai-product-results";

      products.forEach((product) => {
        wrapper.appendChild(createProductCard(product));
      });

      messages.appendChild(wrapper);
      scrollToBottom();
      saveChatSession();
    }

    // ==========================================
    // PERSISTENT PRODUCT CARD EVENTS
    // Works after refresh / session restore
    // ==========================================

    messages.addEventListener("click", (event) => {
      const target = event.target.closest("[data-product-url]");

      if (!target || !messages.contains(target)) return;

      event.preventDefault();

      const productUrl = target.dataset.productUrl;

      if (productUrl) {
        openQuickView(productUrl);
      }
    });

    // ==========================================
    // QUICK VIEW
    // ==========================================

    function removeQuickView() {
      document.getElementById("ai-quick-view-overlay")?.remove();
    }

    async function openQuickView(productUrl) {
      removeQuickView();

      const loading = addBotMessage("Loading product details...");

      try {
        const product = await getFullProduct(productUrl);

        loading.remove();

        currentProduct = product;

        shoppingContext.lastSelectedProductUrl =
          productUrl;

        shoppingContext.lastSelectedProductTitle =
          product.title || "";

        const firstAvailable =
          product.variants?.find((variant) => variant.available) ||
          product.variants?.[0];

        currentVariantId = firstAvailable?.id || null;

        const overlay = document.createElement("div");
        overlay.id = "ai-quick-view-overlay";

        const modal = document.createElement("div");
        modal.className = "ai-quick-view";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "ai-quick-view-close";
        closeButton.textContent = "×";

        closeButton.addEventListener("click", removeQuickView);

        modal.appendChild(closeButton);

        // Image
        const imageUrl =
          product.featured_image ||
          product.images?.[0] ||
          "";

        if (imageUrl) {
          const image = document.createElement("img");
          image.className = "ai-quick-view-image";
          image.src = imageUrl;
          image.alt = product.title;
          modal.appendChild(image);
        }

        const content = document.createElement("div");
        content.className = "ai-quick-view-content";

        const title = document.createElement("h3");
        title.textContent = product.title;
        content.appendChild(title);

        const price = document.createElement("div");
        price.className = "ai-quick-view-price";

        function updatePrice(variant) {
          if (!variant) return;

          price.textContent = formatMoney(
            Number(variant.price || 0) / 100
          );
        }

        updatePrice(firstAvailable);
        content.appendChild(price);

        // Description
        if (product.description) {
          const description = document.createElement("div");
          description.className = "ai-quick-view-description";

          const temp = document.createElement("div");
          temp.innerHTML = product.description;

          const plainText =
            temp.textContent?.replace(/\s+/g, " ").trim() || "";

          description.textContent =
            plainText.length > 240
              ? `${plainText.slice(0, 240)}...`
              : plainText;

          content.appendChild(description);
        }

        // Variant selector
        if (Array.isArray(product.variants) && product.variants.length) {
          const label = document.createElement("label");
          label.className = "ai-variant-label";
          label.textContent = "Choose option";

          const select = document.createElement("select");
          select.className = "ai-variant-select";

          product.variants.forEach((variant) => {
            const option = document.createElement("option");

            option.value = variant.id;

            option.textContent =
              `${variant.title} — ${formatMoney(
                Number(variant.price || 0) / 100
              )}${variant.available ? "" : " — Sold out"}`;

            option.disabled = !variant.available;

            if (variant.id === firstAvailable?.id) {
              option.selected = true;
            }

            select.appendChild(option);
          });

          select.addEventListener("change", () => {
            currentVariantId = Number(select.value);

            const selectedVariant = product.variants.find(
              (variant) => Number(variant.id) === currentVariantId
            );

            updatePrice(selectedVariant);

            if (selectedVariant?.featured_image?.src) {
              const modalImage =
                modal.querySelector(".ai-quick-view-image");

              if (modalImage) {
                modalImage.src = selectedVariant.featured_image.src;
              }
            }
          });

          content.appendChild(label);
          content.appendChild(select);
        }

        // Quantity
        const quantityWrap = document.createElement("div");
        quantityWrap.className = "ai-quantity-wrap";

        const quantityLabel = document.createElement("label");
        quantityLabel.textContent = "Quantity";

        const quantity = document.createElement("input");
        quantity.type = "number";
        quantity.min = "1";
        quantity.value = "1";
        quantity.className = "ai-quantity-input";

        quantityWrap.appendChild(quantityLabel);
        quantityWrap.appendChild(quantity);

        content.appendChild(quantityWrap);

        // Add to cart
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "ai-add-cart";
        addButton.textContent = "Add to cart";

        addButton.addEventListener("click", async () => {
          if (!currentVariantId) {
            addBotMessage("Please select an available product option.");
            return;
          }

          addButton.disabled = true;
          addButton.textContent = "Adding...";

          try {
            const response = await fetch(
              `${window.Shopify?.routes?.root || "/"}cart/add.js`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  items: [
                    {
                      id: currentVariantId,
                      quantity: Math.max(
                        1,
                        Number(quantity.value) || 1
                      ),
                    },
                  ],
                }),
              }
            );

            const result = await response.json();

            if (!response.ok) {
              throw new Error(
                result?.description ||
                result?.message ||
                "Could not add product to cart."
              );
            }

            addButton.textContent = "Added ✓";

            addBotMessage(
              `${currentProduct.title} has been added to your store cart.`
            );

            document.documentElement.dispatchEvent(
              new CustomEvent("cart:refresh", {
                bubbles: true,
              })
            );

            document.dispatchEvent(
              new CustomEvent("cart:refresh", {
                bubbles: true,
              })
            );

            setTimeout(() => {
              addButton.disabled = false;
              addButton.textContent = "Add to cart";
            }, 1200);
          } catch (error) {
            console.error("ADD TO CART ERROR:", error);

            addButton.disabled = false;
            addButton.textContent = "Add to cart";

            addBotMessage(
              error?.message || "I couldn't add that product to the cart."
            );
          }
        });

        content.appendChild(addButton);

        // Full product page
        const productLink = document.createElement("a");
        productLink.className = "ai-full-product-link";
        productLink.href = productUrl;
        productLink.textContent = "View full product details";

        content.appendChild(productLink);

        modal.appendChild(content);
        overlay.appendChild(modal);

        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) {
            removeQuickView();
          }
        });

        document.body.appendChild(overlay);
      } catch (error) {
        console.error("QUICK VIEW ERROR:", error);

        loading.remove();

        addBotMessage(
          "I couldn't load this product's details. Please try again."
        );
      }
    }

    // ==========================================
    // SEARCH
    // ==========================================

    async function handleSearch(value) {
      const loading = addBotMessage(
        "Searching our store for the best matches..."
      );

      try {
        const contextualQuery =
          getContextualQuery(value);

        let products =
          await searchShopifyProducts(
            contextualQuery
          );

        // --------------------------------------
        // Typo fallback
        // progressively retry useful words
        // --------------------------------------

        if (!products.length) {
          const words =
            getSearchWords(contextualQuery);

          for (const word of words) {
            if (word.length < 3) continue;

            products =
              await searchShopifyProducts(word);

            if (products.length) {
              break;
            }

            // Try shorter typo-friendly prefix
            if (word.length >= 5) {
              const prefix =
                word.slice(
                  0,
                  Math.max(3, word.length - 2)
                );

              products =
                await searchShopifyProducts(
                  prefix
                );

              if (products.length) {
                break;
              }
            }
          }
        }

        loading.remove();

        if (!products.length) {
          addBotMessage(
            "I couldn't find a close product match. Try a product type, color, category, or another similar word."
          );

          return;
        }

        products =
          rankProducts(
            products,
            contextualQuery
          );

        // --------------------------------------
        // Remove duplicate products
        // --------------------------------------
        const uniqueProducts = [];
        const seenProducts = new Set();

        for (const product of products) {
          const uniqueKey =
            product.url ||
            product.handle ||
            product.id ||
            product.title;

          if (!uniqueKey || seenProducts.has(uniqueKey)) {
            continue;
          }

          seenProducts.add(uniqueKey);
          uniqueProducts.push(product);
        }

        products = uniqueProducts;

        // --------------------------------------
        // For "similar" requests, avoid showing
        // the exact previously selected product first
        // --------------------------------------
        if (
          isSimilarRequest(value) &&
          shoppingContext.lastSelectedProductUrl
        ) {
          const selectedUrl =
            shoppingContext.lastSelectedProductUrl;

          products = products.filter(
            (product) =>
              product.url !== selectedUrl
          );
        }

        // Maximum useful results in chat
        products = products.slice(0, 6);

        // --------------------------------------
        // Cheaper request
        // --------------------------------------

        if (isCheaperRequest(value)) {
          products = [...products].sort(
            (a, b) =>
              Number(
                a.price ||
                a.price_min ||
                0
              ) -
              Number(
                b.price ||
                b.price_min ||
                0
              )
          );
        }

        shoppingContext.lastQuery =
          contextualQuery;

        shoppingContext.lastProducts =
          products.map((product) => ({
            title: product.title || "",
            url: product.url || "",
            price:
              product.price ||
              product.price_min ||
              ""
          }));

        addBotMessage(
          isSimilarRequest(value)
            ? "Here are some related products I found."
            : isCheaperRequest(value)
            ? "Here are the lower-priced matches I found."
            : `I found ${products.length} matching ${
                products.length === 1
                  ? "product"
                  : "products"
              } in this store.`
        );

        showProducts(products);
      } catch (error) {
        console.error(
          "SMART SEARCH ERROR:",
          error
        );

        loading.remove();

        addBotMessage(
          "I couldn't search the store right now. Please try again."
        );
      }
    }
    // ==========================================
    // CHAT FORM
    // ==========================================

    restoreChatSession();

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const value = input.value.trim();
      if (!value) return;

      addUserMessage(value);

      input.value = "";
      input.disabled = true;

      const submitButton =
        form.querySelector('button[type="submit"]');

      if (submitButton) {
        submitButton.disabled = true;
      }

      try {
        const handledAsCartCommand = await handleCartCommand(value);

        if (!handledAsCartCommand) {
          await handleSearch(value);
        }
      } catch (error) {
        console.error("AI CHAT COMMAND ERROR:", error);

        addBotMessage(
          error?.message ||
          "Something went wrong. Please try again."
        );
      } finally {
        input.disabled = false;

        if (submitButton) {
          submitButton.disabled = false;
        }

        input.focus();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initAIShoppingChat
    );
  } else {
    initAIShoppingChat();
  }

  document.addEventListener(
    "shopify:section:load",
    initAIShoppingChat
  );
})();





