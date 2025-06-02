<script>
  export let id
  export let showModal
  export let close

  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }

  let modal
  $: showModal && requestAnimationFrame(() => requestAnimationFrame(() => modal?.focus()))
</script>

<div class='modal-soft position-absolute d-flex align-items-center justify-content-center z-50 w-full h-full' class:hide={!showModal} class:show={showModal} id={id}>
  <div class='modal-soft-dialog d-flex align-items-center justify-content-center pt-30 mt-sm-20' class:hide={!showModal} class:show={showModal} on:pointerdown|self={close} on:keydown={checkClose} tabindex='-1' role='button' bind:this={modal}>
    <div class='overflow-hidden d-flex flex-column overflow-y-scroll {$$restProps.class}'>
      {#if showModal}
        <slot />
      {/if}
    </div>
  </div>
</div>

<style>
  .pt-30 {
    padding-top: 3rem;
  }
  .modal-soft {
    background-color: rgba(0,0,0,0.85);
    transition: opacity .2s ease-in-out, visibility .2s ease-in-out;
  }
  .modal-soft.show {
    visibility: visible;
    opacity: 1;
  }
  .modal-soft.hide {
    visibility: hidden;
    opacity: 0;
  }
  .modal-soft-dialog {
    width: 100%;
    height: 100%;
    transition: transform .2s ease-in-out;
    transform-origin: bottom center;
  }
  .modal-soft-dialog.show {
    transform: scale(1);
  }
  .modal-soft-dialog.hide {
    transform: scale(0.95);
  }
  .modal-soft-dialog:focus-visible {
    box-shadow: unset !important;
  }
</style>