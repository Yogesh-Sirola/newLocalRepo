/* eslint-disable jsx-a11y/label-has-associated-control */
import React, {
    ChangeEvent, useContext, useEffect, useState,
} from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import { AppContext } from '../../AppContext';
import {
    WarrantyCartProduct, WarrantyCartProductOption, WarrantyProduct, WarrantyProductOption,
} from '../../types/formData';
import { calculatePricing } from '../../helpers/pricing';
import { WARRANTY_UPGRADE_FEE } from '../../../custom/constants';

interface ProductCardProps {
    inputType?: string
    product: WarrantyProduct;
    mostPopularBadge: boolean;
}

export function ProductCard(
    {
        inputType,
        product,
        mostPopularBadge,
    }: ProductCardProps,
) {
    const {
        formData,
        setFormData,
        setDisplayQuickView,
        setQuickViewProduct,
        setDisplayScreenRepairGuarantee,
        isMobile,
        currencySymbol,
    } = useContext(AppContext);
    // Has screen repair option
    const screenRepairGuarantee: WarrantyProductOption | undefined = product.product_options?.find((productOption) => productOption.displayName.toLowerCase().indexOf('screen repair guarantee') > -1);

    // Set current and base prices
    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [originalPrice, setOriginalPrice] = useState<number>(0);
    const [isIsod, setIsIsod] = useState<boolean>(false);
    const productType: string = inputType === 'radio' ? 'replacement' : 'addon';

    // Set pricing when the cartData changes
    useEffect((): void => {
        if (product?.sku?.includes('isod-')) {
            setIsIsod(true);
        }
        const { price, basePrice } = calculatePricing(product.prices?.price.value, product.prices?.basePrice.value || product.prices?.price.value, productType, formData);

        let actualPrice: number = price;

        if (productType === 'replacement' && formData.cartData?.replacementProduct?.id === product.id && formData.cartData.replacementProduct.price) {
            // Replacement product was added to the cart (price could differ due to options selected)
            actualPrice = formData.cartData.replacementProduct.price;
        } else if (productType === 'addon') {
            // Add-on product was added to the cart (price could differ due to options selected)
            const addOnPrice: number | undefined = formData.cartData?.addOnProducts?.find((prod: WarrantyCartProduct): boolean => prod.id === product.id)?.price;
            if (addOnPrice) actualPrice = addOnPrice;
        }

        let useProduct: WarrantyProduct | undefined;
        if (formData) useProduct = formData.rplSkuProduct ? formData.rplSkuProduct : formData.originalProduct;

        if (productType === 'replacement' && useProduct && (useProduct?.inventory?.isInStock && product.id !== useProduct.id)) {
            actualPrice += WARRANTY_UPGRADE_FEE;
        }

        setCurrentPrice(actualPrice);
        setOriginalPrice(basePrice);
    }, [formData.cartData, isIsod]);

    // Check if the product card should have the screen repair guarantee modifier checked
    function checkScreenRepair(): boolean {
        let isChecked: boolean | undefined = false;

        if (productType === 'replacement') {
            isChecked = formData.cartData?.replacementProduct?.id === product.id && typeof formData.cartData?.replacementProduct.options?.find(item => item.nameId === screenRepairGuarantee?.entityId) !== 'undefined';
        } else if (productType === 'addon') {
            isChecked = formData.cartData?.addOnProducts && typeof formData.cartData?.addOnProducts.find((item: WarrantyCartProduct) => item.id === product.id && item.options?.find(opt => opt.nameId === screenRepairGuarantee?.entityId)) !== 'undefined';
        }

        return isChecked || false;
    }

    function renderSelectedOptions() {
        if (product.isVariant && product.variant?.options) {
            return (
                <div className="selected-options">
                    {product.variant?.options.map((option): JSX.Element => (
                        <div key={option.displayName} className="selected-option">
                            <span className="name body-small">{`${option.displayName}: `}</span>
                            <span className="value body-small">{option.values[0].label}</span>
                        </div>
                    ))}
                </div>
            );
        }

        const selectedOptions: WarrantyCartProductOption[] = [];

        if (productType === 'replacement') {
            selectedOptions.push(...(formData.cartData?.replacementProduct?.id === product.id && formData.cartData?.replacementProduct?.options?.filter(opt => opt.name.toLowerCase().indexOf('screen repair guarantee') <= -1) || []));
        } else if (productType === 'addon') {
            const addOnProduct: WarrantyCartProduct | undefined = formData.cartData?.addOnProducts?.find((item: WarrantyCartProduct) => item.id === product.id);
            selectedOptions.push(...(addOnProduct?.options?.filter(opt => opt.name.toLowerCase().indexOf('screen repair guarantee') <= -1) || []));
        }

        return (
            <div className="selected-options">
                {selectedOptions.map((option: WarrantyCartProductOption): JSX.Element => (
                    <div key={option.nameId} className="selected-option">
                        <span className="name body-small">{`${option.name}: `}</span>
                        <span className="value body-small">{option.value}</span>
                    </div>
                ))}
            </div>
        );
    }

    // radio = replacement, checkbox = add on
    function renderInput() {
        switch (inputType) {
            case 'radio':
                return (
                    <input
                        id={`select-product-${product.id}`}
                        type="radio"
                        name="upgradeOption"
                        onChange={(e: ChangeEvent<HTMLInputElement>): void => handleSelection(e)}
                        checked={formData.cartData?.replacementProduct?.id === product.id}
                        className="form-radio"
                    />
                );
            case 'checkbox':
                return (
                    <input
                        type="checkbox"
                        id={`select-product-${product.id}`}
                        onChange={(e: ChangeEvent<HTMLInputElement>): void => handleSelection(e)}
                        checked={typeof formData.cartData?.addOnProducts?.find(addOn => addOn.id === product.id) !== 'undefined'}
                        className="form-checkbox"
                    />
                );
            default:
                break;
        }
    }

    // Set QV product and display modal
    function showQuickView(): void {
        setQuickViewProduct({ product, type: productType });
        setDisplayQuickView(true);
    }

    // Handle product selection
    function handleSelection(e: { target: any; }) {
        const addOnProducts: WarrantyCartProduct[] = formData.cartData?.addOnProducts || [];
        const added: boolean = e.target.checked;
        switch (inputType) {
            case 'radio':
                if (window.location.href.includes('isod_product=')) {
                    setFormData({
                        ...formData,
                        cartData: {
                            ...formData.cartData,
                            replacementProduct: {
                                id: product.id,
                                variant_id: product.variant_id,
                                quantity: 1,
                            },
                        },
                        modifiers: {
                            'Device Type': decodeURI(window.location.href).split('isod_product=[')[1].split(']&')[0].split(',')[0],
                            'Device Brand': decodeURI(window.location.href).split('isod_product=[')[1].split(']&')[0].split(',')[1],
                            'Device Model': decodeURI(window.location.href).split('isod_product=[')[1].split(']&')[0].split(',')[2],
                            Coverage: decodeURI(window.location.href).split('isod_product=[')[1].split(']&')[0].split(',')[3],
                            Material: decodeURIComponent(decodeURIComponent(window.location.href).split('isod_product=[')[1].split(']&')[0].split(',')[4].split(']')[0]),
                        },
                    });
                } else if (product.product_options?.length) {
                    showQuickView();
                } else {
                    setFormData({
                        ...formData,
                        cartData: {
                            ...formData.cartData,
                            replacementProduct: {
                                id: product.id,
                                variant_id: product.variant_id,
                                quantity: 1,
                            },
                        },
                    });
                }
                break;
            case 'checkbox':
                // Remove product from add ons
                if (!added) {
                    addOnProducts.splice(addOnProducts.findIndex(item => item.id === product.id), 1);
                } else if (product.product_options?.length) {
                    showQuickView();
                    break;
                } else {
                    // Add product to add ons
                    addOnProducts.push({
                        id: product.id,
                        quantity: 1,
                    });
                }
                // add-ons
                setFormData({
                    ...formData,
                    cartData: {
                        ...formData.cartData,
                        addOnProducts,
                    },
                });
                break;
            default:
                break;
        }
    }

    return (
        <div className={`warranty-product-card-wrapper ${product.most_popular ? 'popular' : ''}`}>
            {product.most_popular && mostPopularBadge && (
                <div className="most-popular-badge">Most Popular</div>
            )}
            <label
                htmlFor={`select-product-${product.id}`}
                className={
                    `warranty-product-card
                    ${formData.cartData?.replacementProduct && formData.cartData.replacementProduct.id === product.id ? ' border-1px-solid-charcoal' : ''}
                    `
                }
            >
                <span className="is-srOnly">{`Select ${product.name}`}</span>
                <div className="left-side">
                    <LazyLoadImage
                        src={product.image}
                        alt={product.alt_text}
                        height="97px"
                        width="97px"
                        className="product-img"
                    />
                    <div className="input-wrapper">
                        {renderInput()}
                        <span className="body-large form-label">
                            Select
                        </span>
                    </div>
                </div>

                <div className="product-info">
                    <p className="name h6">{product.name}</p>
                    {product.compatibility && (
                        <p className="compatibility">
                            for
                            {' '}
                            {isMobile ? (
                                <span className="bold">
                                    {product.compatibility?.split(',')[0]}
                                </span>
                            ) : (
                                <span className="bold">{product.compatibility}</span>
                            )}
                        </p>
                    )}

                    {renderSelectedOptions()}

                    {product.product_options && product.product_options?.length > 0 && (
                        <p className="product-options">
                            <button
                                type="button"
                                className="button button--unstyled"
                                onClick={() => showQuickView()}
                            >
                                <svg className="icon"><use xlinkHref="#icon-plus" /></svg>
                                <span className="body-small">Options</span>
                            </button>
                        </p>
                    )}
                    {screenRepairGuarantee && (
                        <div className="gap gap-10px screen-repair">
                            <input
                                id={`add-screen-repair-guarantee-option-${product.id}`}
                                type="checkbox"
                                checked={checkScreenRepair()}
                                onChange={() => showQuickView()}
                                className="form-checkbox"
                            />
                            <label
                                htmlFor={`add-screen-repair-guarantee-option-${product.id}`}
                                className="form-label"
                            >
                                <span>{`${screenRepairGuarantee.displayName} (${screenRepairGuarantee.label})`}</span>
                            </label>

                            <button
                                type="button"
                                className="button button--unstyled"
                                onClick={() => setDisplayScreenRepairGuarantee(true)}
                            >
                                <svg className="icon"><use xlinkHref="#icon-info" /></svg>
                            </button>
                        </div>
                    )}
                    <div className="price">
                        {/* This should be the current price minus the price the customer paid originally */}
                        <p className="current body-large">
                            {currentPrice > 0 ? (
                                <span>{`+${currencySymbol}${currentPrice.toFixed(2)}`}</span>
                            ) : (
                                <span>Free</span>
                            )}
                        </p>
                        {(currentPrice < originalPrice) && (
                            <p className="line-through body-large">
                                {`${currencySymbol}${originalPrice.toFixed(2)}`}
                            </p>
                        )}
                    </div>
                </div>
                {!isIsod && (
                    <button
                        type="button"
                        className="button button--unstyled quick-view-button"
                        onClick={() => showQuickView()}
                    >
                        <svg className="icon"><use xlinkHref="#icon-quick-view" /></svg>
                    </button>
                )}
            </label>
        </div>
    );
}