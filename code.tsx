import React, { useContext, useEffect, useState } from "react";
import { ProductCard } from "./products/product-card";
import { AppContext } from "../AppContext";
import { BackInStock } from "./products/back-in-stock";
import { EndOfLife } from "./products/end-of-life";
import {
  GraphQLService,
  LoggingService,
  ReplacementProduct,
} from "../../../shared/services";
import { getProductData, formatProductObject } from "../helpers/product-data";
import { WarrantyProduct } from "../types/formData";
import { WarrantyCardsLoader } from "./skeletons/warranty-cards-loader";
import { ReplacementTree } from "../../types/replacementTree";
import {
  formatAPIProduct,
  getHiddenProduct,
  getWarrantyReplacementTree,
} from "../../custom/middleware";
import { recursivelyParseTree } from "../helpers/tree";
import { IAPIProduct } from "../../types/restTypes";
import {
  METAFIELD_HIDE_FROM_WARRANTY,
  METAFIELD_NAME_IS_REGISTERABLE,
} from "../../custom/constants";

export interface UpgradeOptions {
  productIds: number[];
  products: Record<number, ReplacementTree.ReplaceProduct>;
}

const UPGRADE_OPTIONS_LIMIT: number = 10;

const logger = new LoggingService("SelectReplacement");

export function SelectReplacement() {
  const {
    formData,
    setFormData,
    context,
    // setBannerMessage,
    bannerMessage,
    setItemPrice,
  } = useContext(AppContext);

  const [noResults, setNoResults] = useState < boolean > false;

  // variable that holds main product - either rpl_sku, original product, or undefined
  let useProduct: WarrantyProduct | undefined;
  if (formData)
    useProduct = formData.rplSkuProduct
      ? formData.rplSkuProduct
      : formData.originalProduct;

  if (useProduct?.prices) {
    let price = useProduct?.prices.basePrice.value;
    if (useProduct?.prices?.salePrice?.value) {
      price = useProduct?.prices?.salePrice?.value;
    } else {
      price = useProduct?.prices?.price.value;
    }
    setItemPrice(price);
  }

  // Load replacement options from tree
  async function getUpgradeOptions(
    warrantyProductCatIds: number[] | undefined,
    productId: number
  ): Promise<UpgradeOptions> {
    const result: UpgradeOptions = { productIds: [], products: {} };

    try {
      if (typeof warrantyProductCatIds === "undefined") return result;

      const replacementTree: ReplacementTree.Tree | undefined =
        await getWarrantyReplacementTree();

      if (!replacementTree) {
        return result;
      }

      const selectedProduct: ReplacementTree.ReplaceProduct =
        replacementTree.products[productId];
      const nodeToParse: ReplacementTree.categories | undefined =
        replacementTree?.tree.find(
          (node: ReplacementTree.categories): boolean =>
            warrantyProductCatIds.includes(node.categoryId)
        );

      if (!nodeToParse) {
        return result;
      }

      const upgradeProductIds: number[] | undefined = recursivelyParseTree(
        nodeToParse,
        warrantyProductCatIds
      );

      if (!upgradeProductIds) {
        return result;
      }
      const graphQLService: GraphQLService = new GraphQLService(
        context.storefrontAPIToken
      );
      const upgradeProductWarrantyFields =
        await graphQLService.getWarrantyFields(upgradeProductIds);
      for await (const id of upgradeProductIds) {
        const product: ReplacementTree.ReplaceProduct =
          replacementTree.products[id];
        const productField = upgradeProductWarrantyFields.find(
          (p: any) => p.entityId === id
        );
        let isRegisterable: boolean = true;
        let hideFromWarranty: boolean = false;
        if (!productField) {
          const apiProduct: IAPIProduct | undefined = await getHiddenProduct(
            id,
            "id",
            context.customer?.id
          );
          isRegisterable =
            apiProduct?.metafields?.find(
              (m: any) => m?.key === METAFIELD_NAME_IS_REGISTERABLE
            )?.value === "true";
          hideFromWarranty =
            apiProduct?.metafields
              ?.find((m: any) => m?.key === METAFIELD_HIDE_FROM_WARRANTY)
              ?.value?.toLowerCase() === "true";
        } else {
          isRegisterable =
            productField?.metafields?.edges?.find(
              (m: any) => m?.node?.key === METAFIELD_NAME_IS_REGISTERABLE
            )?.node?.value === "true";
          hideFromWarranty =
            productField?.metafields?.edges
              ?.find((m: any) => m?.node?.key === METAFIELD_HIDE_FROM_WARRANTY)
              ?.node?.value?.toLowerCase() === "true";
        }

        if (product.id !== productId) {
          if (
            (!selectedProduct.device ||
              selectedProduct.device.every(
                (device: string): boolean => !!product.device?.includes(device)
              )) &&
            isRegisterable &&
            !hideFromWarranty
          ) {
            result.products[id] = product;
            result.productIds.push(id);
          }
        }
      }

      return result;
    } catch (err) {
      logger.colorize.error("Error", err);
      setNoResults(true);
      return result;
    }
  }

  // Load the rest of the product data
  useEffect((): void => {
    (async (): Promise<void> => {
      const { id, categories = [] } = formData.originalProduct || {};
      const warrantyProductCatIds: number[] | undefined = categories.map(
        (cat: { id: number }): number => cat.id
      );

      if (!id) {
        throw new Error("Required product ID is missing from form data.");
      }

      /**
       * Step 1: create array of product IDs
       */
      const { productIds }: UpgradeOptions = await getUpgradeOptions(
        warrantyProductCatIds,
        id
      );

      if (!productIds.length) {
        setNoResults(true);
        // setBannerMessage({ message: "Sorry, we've encountered an error. Please contact support.", type: 'error', display: true });
        return;
      }

      /**
       * Get product data from gql
       */
      const products: ReplacementProduct[] | undefined = await getProductData(
        context,
        productIds
      );

      if (!products || products.length < productIds.length) {
        // check for hidden products
        const missingProductIds: number[] = productIds.filter(
          (p_id: number): boolean =>
            !products?.find((product) => product.entityId === p_id)
        );
        const missingProducts: IAPIProduct[] = await Promise.all(
          missingProductIds.map((p_id: number) =>
            getHiddenProduct(p_id, "id", context.customer?.id).then((res) => {
              if (res === undefined) {
                const error = new Error(
                  "system error: unable to load product data."
                );
                logger.colorize.error(error);
                throw error;
              }
              return res;
            })
          )
        );
        products?.push(...missingProducts?.map((p) => formatAPIProduct(p)));
        // if still missing products, set no results
        if (!products || !products.length) {
          setNoResults(true);
          return;
        }
      }

      let upgradeOptions: WarrantyProduct[] = [];
      const formattedProducts: WarrantyProduct[] = [];

      /**
       * Map gql product data AND replace with replacement version if in tree
       */
      // build formatted products array
      for await (const product of products) {
        const formattedProduct: WarrantyProduct = await formatProductObject(
          product
        );
        formattedProducts.push(formattedProduct);
      }

      // replace original with replacement if found above
      for await (let formattedProduct of formattedProducts) {
        // if replacement found, format correctly and use that
        if (formattedProduct.rpl_sku) {
          const replacementProduct = formattedProducts.find(
            (item) => item.sku === formattedProduct.rpl_sku
          );
          if (replacementProduct) {
            formattedProduct = replacementProduct;
          }
        }

        // don't add if sku is already in upgrade options
        const skuFoundInUpgradeOptions = upgradeOptions.find(
          (item) => item.id === formattedProduct.id
        );
        if (!skuFoundInUpgradeOptions) {
          upgradeOptions.push(formattedProduct);
        }
      }

      // remove the original product and out of stock products & limits result to constant variable
      upgradeOptions = upgradeOptions
        .filter(
          (p: WarrantyProduct): boolean | undefined =>
            !p.inventory || p.inventory.isInStock
        )
        .slice(0, UPGRADE_OPTIONS_LIMIT);

      if (!upgradeOptions.length) {
        setNoResults(true);
      }

      setFormData({
        ...formData,
        upgradeOptions: upgradeOptions.sort(
          (x: WarrantyProduct, y: WarrantyProduct): number =>
            Number(y.most_popular) - Number(x.most_popular)
        ),
      });
    })();
  }, []);

  function renderReplacement() {
    return (
      typeof useProduct !== "undefined" && (
        <ProductCard
          product={useProduct}
          inputType="radio"
          mostPopularBadge={false}
        />
      )
    );
  }

  function renderBackInStock() {
    return (
      typeof useProduct !== "undefined" && <BackInStock product={useProduct} />
    );
  }

  function renderEndOfLife(hasUpgradeOptions: boolean) {
    return (
      typeof useProduct !== "undefined" && (
        <EndOfLife product={useProduct} hasUpgradeOptions={hasUpgradeOptions} />
      )
    );
  }

  if (bannerMessage.display) {
    return <></>;
  }

  return (
    <div>
      <div className="gap gap-10px section-heading">
        {useProduct &&
          useProduct?.eol &&
          (useProduct && useProduct?.inventory?.isInStock ? (
            <p className="h4">Select Replacement</p>
          ) : (
            <p className="h4">Discontinued Item</p>
          ))}
        {useProduct &&
          !useProduct?.eol &&
          (useProduct && useProduct?.inventory?.isInStock ? (
            <p className="h4">Select Replacement</p>
          ) : (
            <p className="h4">Notify Me When Back in Stock</p>
          ))}
        <p className="body-large">Your Product</p>
      </div>
      <div className="grid">
        {formData &&
          useProduct &&
          useProduct?.eol &&
          (useProduct && useProduct?.inventory?.isInStock ? (
            <div className="grid__item large-up--one-half">
              {renderReplacement()}
            </div>
          ) : (
            <div className="grid__item one-whole">
              {renderEndOfLife(
                typeof formData.upgradeOptions !== "undefined" &&
                  formData.upgradeOptions?.length > 0
              )}
            </div>
          ))}
        {useProduct &&
          !useProduct?.eol &&
          (useProduct && useProduct?.inventory?.isInStock ? (
            <div className="grid__item large-up--one-half">
              {renderReplacement()}
            </div>
          ) : (
            <div className="grid__item one-whole">{renderBackInStock()}</div>
          ))}
      </div>

      {!noResults && (
        <>
          {formData?.upgradeOptions?.length && (
            <div className="gap gap-10px section-heading">
              <p className="h4">Upgrade Options</p>
              <p className="body-large">
                See Similar Products Below And Upgrade.
              </p>
            </div>
          )}
          <div className="grid">
            {!formData?.upgradeOptions && <WarrantyCardsLoader />}
            {formData?.upgradeOptions?.map((replacementOption) => (
              <div
                className="grid__item large-up--one-half"
                key={replacementOption.id}
              >
                <ProductCard
                  product={replacementOption}
                  inputType="radio"
                  mostPopularBadge
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
