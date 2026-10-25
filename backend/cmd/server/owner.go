package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"bomish/internal/app"
	"bomish/internal/security"
)

func setupOwner(ctx context.Context, a *app.App, recoverOwner bool) error {
	input := bufio.NewReader(os.Stdin)
	ask := func(label string) (string, error) {
		fmt.Fprint(os.Stdout, label)
		line, err := input.ReadString('\n')
		return strings.TrimSpace(line), err
	}
	name, err := ask("Owner full name: ")
	if err != nil {
		return err
	}
	username, err := ask("Owner username: ")
	if err != nil {
		return err
	}
	// The bootstrap command requires an attached terminal, so secrets cannot land
	// in shell history, environment files or noninteractive CI logs.
	echo := func(arg string) error { cmd := exec.Command("stty", arg); cmd.Stdin = os.Stdin; return cmd.Run() }
	if err = echo("-echo"); err != nil {
		return errors.New("an interactive terminal is required (docker compose run --rm owner-tools bootstrap-owner)")
	}
	defer echo("echo")
	password, err := ask("Password (12+ characters, hidden): ")
	fmt.Println()
	if err != nil {
		return err
	}
	confirmation, err := ask("Repeat password: ")
	fmt.Println()
	if err != nil {
		return err
	}
	if password != confirmation {
		return errors.New("passwords do not match")
	}
	if err = echo("echo"); err != nil {
		return err
	}
	secret := security.NewTOTPSecret()
	fmt.Printf("Add this key to your authenticator for Bomish / %s:\n%s\n", username, secret)
	code, err := ask("Current authenticator code: ")
	if err != nil {
		return err
	}
	if err = a.BootstrapOwner(ctx, name, username, password, secret, code, recoverOwner); err != nil {
		return err
	}
	fmt.Println("Owner saved. Password signs into /staff; authenticator unlocks /omnisire. Wait for a fresh code before unlocking.")
	return nil
}
