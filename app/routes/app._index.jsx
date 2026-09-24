import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const fetcher = useFetcher();

  const [message, setMessage] = useState("");

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi! 👋 What are you looking for today?",
    },
  ]);

  const [products, setProducts] = useState([]);

  // Store selected variant for each product
  const [selectedVariants, setSelectedVariants] =
    useState({});

  const isLoading =
    fetcher.state === "submitting" ||
    fetcher.state === "loading";

  // ============================================
  // AI RESPONSE
  // ============================================

  useEffect(() => {
    if (
      fetcher.data?.success &&
      fetcher.data?.message
    ) {
      setMessages((prev) => {
        const lastMessage =
          prev[prev.length - 1];

        if (
          lastMessage?.role === "assistant" &&
          lastMessage?.text ===
            fetcher.data.message
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            role: "assistant",
            text: fetcher.data.message,
          },
        ];
      });
    }
  }, [fetcher.data]);

  // ============================================
  // SHOPIFY PRODUCTS
  // ============================================

  useEffect(() => {
    const shopifyResult =
      fetcher.data?.shopifyResult;

    if (!shopifyResult) return;

    const returnedProducts =
      Array.isArray(shopifyResult.products)
        ? shopifyResult.products
        : [];

    console.log(
      "SHOPIFY PRODUCTS:",
      returnedProducts
    );

    if (returnedProducts.length > 0) {
      setProducts(returnedProducts);

      // Automatically select first available
      // variant for every product
      const initialVariants = {};

      returnedProducts.forEach(
        (product, productIndex) => {
          const variants =
            Array.isArray(product?.variants)
              ? product.variants
              : [];

          const availableVariant =
            variants.find(
              (variant) =>
                variant?.availability
                  ?.available === true
            ) || variants[0];

          if (availableVariant) {
            const productKey =
              product.id ||
              product.handle ||
              String(productIndex);

            initialVariants[productKey] =
              availableVariant.id;
          }
        }
      );

      setSelectedVariants(initialVariants);
    } else {
      setProducts([]);
      setSelectedVariants({});
    }
  }, [fetcher.data?.shopifyResult]);

  // ============================================
  // SEND MESSAGE
  // ============================================

  const sendMessage = () => {
    const value = message.trim();

    if (!value || isLoading) return;

    const updatedMessages = [
      ...messages,
      {
        role: "user",
        text: value,
      },
    ];

    setMessages(updatedMessages);

    setMessage("");

    fetcher.submit(
      {
        message: value,
        history: JSON.stringify(
          updatedMessages
        ),
      },
      {
        method: "POST",
        action: "/app/agent",
      }
    );
  };

  // ============================================
  // ENTER KEY
  // ============================================

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendMessage();
    }
  };

  // ============================================
  // FORMAT MONEY
  // Shopify returns minor currency units
  // 50000 INR = ₹500
  // ============================================

  const formatMoney = (
    amount,
    currency = "INR"
  ) => {
    if (
      amount === null ||
      amount === undefined ||
      amount === ""
    ) {
      return "";
    }

    const numberAmount = Number(amount);

    if (Number.isNaN(numberAmount)) {
      return "";
    }

    const majorAmount =
      numberAmount / 100;

    try {
      return new Intl.NumberFormat(
        "en-IN",
        {
          style: "currency",
          currency:
            currency || "INR",
          maximumFractionDigits: 2,
        }
      ).format(majorAmount);
    } catch {
      return `₹${majorAmount}`;
    }
  };

  // ============================================
  // PRODUCT IMAGE
  // ============================================

  const getProductImage = (product) => {
    const media = product?.media?.[0];

    return (
      media?.image?.url ||
      media?.preview_image?.url ||
      media?.url ||
      media?.src ||
      ""
    );
  };

  // ============================================
  // VARIANT IMAGE
  // ============================================

  const getVariantImage = (variant) => {
    const media = variant?.media?.[0];

    return (
      media?.image?.url ||
      media?.preview_image?.url ||
      media?.url ||
      media?.src ||
      ""
    );
  };

  // ============================================
  // DESCRIPTION
  // ============================================

  const getDescription = (product) => {
    const description =
      product?.description;

    if (!description) return "";

    if (
      typeof description === "string"
    ) {
      return description;
    }

    if (
      typeof description === "object" &&
      typeof description.html ===
        "string"
    ) {
      return description.html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return "";
  };

  // ============================================
  // GET SELECTED VARIANT
  // ============================================

  const getSelectedVariant = (
    product,
    productIndex
  ) => {
    const variants =
      Array.isArray(product?.variants)
        ? product.variants
        : [];

    const productKey =
      product.id ||
      product.handle ||
      String(productIndex);

    const selectedId =
      selectedVariants[productKey];

    return (
      variants.find(
        (variant) =>
          variant.id === selectedId
      ) ||
      variants.find(
        (variant) =>
          variant?.availability
            ?.available === true
      ) ||
      variants[0] ||
      null
    );
  };

  // ============================================
  // CHANGE VARIANT
  // ============================================

  const handleVariantChange = (
    product,
    productIndex,
    variantId
  ) => {
    const productKey =
      product.id ||
      product.handle ||
      String(productIndex);

    setSelectedVariants((prev) => ({
      ...prev,
      [productKey]: variantId,
    }));
  };

  // ============================================
  // ADD TO CART
  // Uses checkout URL returned by Shopify UCP
  // ============================================

  const handleAddToCart = (
    selectedVariant
  ) => {
    if (!selectedVariant) return;

    if (
      selectedVariant?.availability
        ?.available !== true
    ) {
      return;
    }

    const checkoutUrl =
      selectedVariant?.checkout_url;

    if (!checkoutUrl) {
      alert(
        "Cart URL is not available for this variant."
      );
      return;
    }

    window.open(
      checkoutUrl,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <s-page heading="AI Shopping Agent">
      <s-section>
        <s-stack
          direction="block"
          gap="base"
        >

          {/* ==================================
              HEADER
          ================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="large"
            background="subdued"
          >
            <s-stack
              direction="block"
              gap="small"
            >

              <s-heading>
                🛍️ AI Shopping Assistant
              </s-heading>

              <s-paragraph>
                Tell me what you are looking
                for and I&apos;ll search the
                live Shopify catalog for you.
              </s-paragraph>

              <s-text>
                ✨ Dynamic product search •
                Live prices • Real Shopify
                products
              </s-text>

            </s-stack>
          </s-box>

          {/* ==================================
              CHAT
          ================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="large"
          >
            <s-stack
              direction="block"
              gap="large"
            >

              {messages.map(
                (item, index) => (
                  <s-box
                    key={`${item.role}-${index}`}
                    padding="base"
                    borderRadius="base"
                    background={
                      item.role === "user"
                        ? "subdued"
                        : "base"
                    }
                  >
                    <s-stack
                      direction="block"
                      gap="small"
                    >

                      <s-text>
                        <strong>
                          {item.role ===
                          "user"
                            ? "You"
                            : "AI Shopping Agent"}
                        </strong>
                      </s-text>

                      <s-paragraph>
                        {item.text}
                      </s-paragraph>

                    </s-stack>
                  </s-box>
                )
              )}

              {/* LOADING */}

              {isLoading && (
                <s-box
                  padding="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack
                    direction="inline"
                    gap="small"
                  >
                    <s-spinner />

                    <s-text>
                      Searching the live
                      Shopify catalog...
                    </s-text>
                  </s-stack>
                </s-box>
              )}

              {/* ERROR */}

              {fetcher.data?.success ===
                false && (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack
                    direction="block"
                    gap="small"
                  >
                    <s-heading>
                      Something went wrong
                    </s-heading>

                    <s-paragraph>
                      {fetcher.data.error}
                    </s-paragraph>

                  </s-stack>
                </s-box>
              )}

            </s-stack>
          </s-box>

          {/* ==================================
              PRODUCT RESULTS
          ================================== */}

          {products.length > 0 && (
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="large"
            >
              <s-stack
                direction="block"
                gap="large"
              >

                <s-heading>
                  Products found for you
                </s-heading>

                <s-text>
                  Choose an available variant
                  and add it to your Shopify
                  cart.
                </s-text>

                {products.map(
                  (product, productIndex) => {
                    const variants =
                      Array.isArray(
                        product?.variants
                      )
                        ? product.variants
                        : [];

                    const selectedVariant =
                      getSelectedVariant(
                        product,
                        productIndex
                      );

                    const productKey =
                      product.id ||
                      product.handle ||
                      String(
                        productIndex
                      );

                    const productImage =
                      getProductImage(
                        product
                      );

                    const variantImage =
                      getVariantImage(
                        selectedVariant
                      );

                    const image =
                      variantImage ||
                      productImage;

                    const description =
                      getDescription(
                        product
                      );

                    const available =
                      selectedVariant
                        ?.availability
                        ?.available === true;

                    const variantPrice =
                      selectedVariant?.price;

                    const price =
                      formatMoney(
                        variantPrice?.amount,
                        variantPrice
                          ?.currency ||
                          "INR"
                      );

                    const listPrice =
                      formatMoney(
                        selectedVariant
                          ?.list_price
                          ?.amount,
                        selectedVariant
                          ?.list_price
                          ?.currency ||
                          "INR"
                      );

                    return (
                      <s-box
                        key={productKey}
                        padding="large"
                        borderWidth="base"
                        borderRadius="large"
                        background="subdued"
                      >
                        <s-stack
                          direction="block"
                          gap="base"
                        >

                          {/* IMAGE */}

                          {image && (
                            <img
                              src={image}
                              alt={
                                product.title ||
                                "Shopify product"
                              }
                              style={{
                                width:
                                  "220px",
                                height:
                                  "220px",
                                objectFit:
                                  "cover",
                                borderRadius:
                                  "12px",
                                display:
                                  "block",
                              }}
                            />
                          )}

                          {/* TITLE */}

                          <s-heading>
                            {product.title ||
                              "Shopify Product"}
                          </s-heading>

                          {/* PRICE */}

                          {price && (
                            <s-text>
                              <strong>
                                {price}
                              </strong>
                            </s-text>
                          )}

                          {/* COMPARE PRICE */}

                          {listPrice &&
                            listPrice !==
                              price && (
                              <s-text>
                                Regular price:{" "}
                                {listPrice}
                              </s-text>
                            )}

                          {/* DESCRIPTION */}

                          {description && (
                            <s-paragraph>
                              {description}
                            </s-paragraph>
                          )}

                          {/* VARIANT SELECT */}

                          {variants.length >
                            0 && (
                            <s-stack
                              direction="block"
                              gap="small"
                            >

                              <s-text>
                                <strong>
                                  Select variant
                                </strong>
                              </s-text>

                              <select
                                value={
                                  selectedVariant
                                    ?.id ||
                                  ""
                                }
                                onChange={(
                                  event
                                ) =>
                                  handleVariantChange(
                                    product,
                                    productIndex,
                                    event
                                      .target
                                      .value
                                  )
                                }
                                style={{
                                  width:
                                    "100%",
                                  maxWidth:
                                    "420px",
                                  minHeight:
                                    "42px",
                                  padding:
                                    "8px 12px",
                                  border:
                                    "1px solid #8c9196",
                                  borderRadius:
                                    "8px",
                                  background:
                                    "#ffffff",
                                  fontSize:
                                    "14px",
                                }}
                              >
                                {variants.map(
                                  (
                                    variant
                                  ) => {
                                    const variantAvailable =
                                      variant
                                        ?.availability
                                        ?.available ===
                                      true;

                                    const optionPrice =
                                      formatMoney(
                                        variant
                                          ?.price
                                          ?.amount,
                                        variant
                                          ?.price
                                          ?.currency ||
                                          "INR"
                                      );

                                    return (
                                      <option
                                        key={
                                          variant.id
                                        }
                                        value={
                                          variant.id
                                        }
                                      >
                                        {variant.title ||
                                          "Variant"}
                                        {" — "}
                                        {optionPrice}
                                        {variantAvailable
                                          ? ""
                                          : " — Sold out"}
                                      </option>
                                    );
                                  }
                                )}
                              </select>

                            </s-stack>
                          )}

                          {/* SELECTED VARIANT */}

                          {selectedVariant && (
                            <s-stack
                              direction="block"
                              gap="small"
                            >

                              <s-text>
                                Selected:{" "}
                                <strong>
                                  {
                                    selectedVariant.title
                                  }
                                </strong>
                              </s-text>

                              <s-text>
                                Status:{" "}
                                {available
                                  ? "Available"
                                  : "Sold out"}
                              </s-text>

                            </s-stack>
                          )}

                          {/* ADD TO CART */}

                          <s-button
                            variant="primary"
                            disabled={
                              !selectedVariant ||
                              !available ||
                              !selectedVariant
                                ?.checkout_url
                            }
                            onClick={() =>
                              handleAddToCart(
                                selectedVariant
                              )
                            }
                          >
                            {available
                              ? "Add to Cart"
                              : "Sold Out"}
                          </s-button>

                        </s-stack>
                      </s-box>
                    );
                  }
                )}

              </s-stack>
            </s-box>
          )}

          {/* ==================================
              MCP CREATED CART
          ================================== */}

          {fetcher.data?.cart
            ?.continue_url && (
            <s-box
              padding="large"
              borderWidth="base"
              borderRadius="large"
            >
              <s-stack
                direction="block"
                gap="base"
              >

                <s-heading>
                  🛒 Your cart is ready
                </s-heading>

                <s-paragraph>
                  Your selected product has
                  been added to the Shopify
                  cart.
                </s-paragraph>

                <s-button
                  variant="primary"
                  href={
                    fetcher.data.cart
                      .continue_url
                  }
                  target="_blank"
                >
                  Continue to Checkout
                </s-button>

              </s-stack>
            </s-box>
          )}

          {/* ==================================
              INPUT
          ================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="large"
          >
            <s-stack
              direction="block"
              gap="base"
            >

              <s-heading>
                What are you looking for?
              </s-heading>

              <s-text-area
                label="Shopping request"
                value={message}
                onChange={(event) =>
                  setMessage(
                    event.currentTarget
                      .value
                  )
                }
                onKeyDown={
                  handleKeyDown
                }
                placeholder="Example: Find me a men's t-shirt under ₹500"
                rows="3"
              />

              <s-stack
                direction="inline"
                gap="base"
              >

                <s-button
                  variant="primary"
                  onClick={sendMessage}
                  {...(isLoading
                    ? {
                        loading: true,
                      }
                    : {})}
                >
                  {isLoading
                    ? "Searching..."
                    : "Search Products"}
                </s-button>

                <s-button
                  onClick={() =>
                    setMessage("")
                  }
                  disabled={isLoading}
                >
                  Clear
                </s-button>

              </s-stack>

            </s-stack>
          </s-box>

          {/* ==================================
              EXAMPLES
          ================================== */}

          <s-section heading="Try asking">
            <s-stack
              direction="block"
              gap="small"
            >

              <s-text>
                • Find a men&apos;s shirt
                under ₹500
              </s-text>

              <s-text>
                • Show me available shirts
              </s-text>

              <s-text>
                • Find a product for summer
                under ₹1000
              </s-text>

              <s-text>
                • Find me an available
                men&apos;s shirt under ₹500
              </s-text>

            </s-stack>
          </s-section>

        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (
  headersArgs
) => {
  return boundary.headers(
    headersArgs
  );
};